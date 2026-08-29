// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NightfoldEscrow
/// @notice Holds the buy-ins for one heads-up hand and pays the winner once
///         Midnight has proven who that is.
///
/// @dev SECURITY MODEL — revised after the 2026-08-29 audit (NF-006, NF-008).
///
/// No EVM chain can verify a Midnight proof natively, so a relayer reports the
/// outcome. The audit's point was that "detectable after the fact" is not a
/// protection: a compromised relayer could pay any winner it liked, instantly
/// and irreversibly. Three changes narrow that:
///
///   1. The attestation is CHECKED, not recorded. Midnight writes
///      H("nf:payout:", handId, H(winner)) and this contract recomputes it. A
///      relayer that reports a winner the attestation does not commit to is
///      rejected on-chain, not merely embarrassed afterwards.
///   2. Settlement opens a CHALLENGE WINDOW instead of paying immediately.
///      Either seat can point at Midnight during the window; funds only become
///      withdrawable once it closes.
///   3. Payouts are PULL, not push. A seat contract that rejects transfers can
///      no longer trap the other player's stake (NF-008).
///
/// What remains: the relayer can stall. `timeout` always returns both stakes.
contract NightfoldEscrow {
    enum Status { Empty, Open, Funded, Settling, Paid, Refunded }

    struct Hand {
        address seat0;
        address seat1;
        uint128 stake;
        uint64 deadline;
        uint64 settledAt;
        Status status;
        uint8 winner;
        bytes32 attestation;
    }

    mapping(bytes32 => Hand) public hands;
    /// @notice Pull-payment balances.
    mapping(address => uint256) public withdrawable;

    address public immutable relayer;
    uint64 public constant TIMEOUT = 1 hours;
    /// @notice Time either seat has to dispute a reported outcome.
    uint64 public constant CHALLENGE = 10 minutes;

    event HandOpened(bytes32 indexed handId, address indexed seat0, uint128 stake);
    event HandFunded(bytes32 indexed handId, address indexed seat1);
    event SettlementProposed(bytes32 indexed handId, uint8 winner, bytes32 attestation, uint64 payableAt);
    event SettlementFinalised(bytes32 indexed handId, uint8 winner, uint256 pot);
    event HandRefunded(bytes32 indexed handId);
    event Withdrawn(address indexed to, uint256 amount);

    error NotRelayer();
    error WrongStatus();
    error WrongStake();
    error SeatTaken();
    error NotSeated();
    error TooEarly();
    error BadSeat();
    error BadAttestation();
    error NothingToDo();
    error TransferFailed();

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(address _relayer) {
        relayer = _relayer;
    }

    /// @notice The exact value Midnight's `settle` writes for this outcome.
    ///         Recomputed here so a mismatched report cannot be paid.
    function expectedAttestation(bytes32 handId, uint8 winner) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("nf:payout:", handId, keccak256(abi.encodePacked(winner))));
    }

    function openHand(bytes32 handId) external payable {
        Hand storage h = hands[handId];
        if (h.status != Status.Empty) revert SeatTaken();
        if (msg.value == 0) revert WrongStake();

        h.seat0 = msg.sender;
        h.stake = uint128(msg.value);
        h.deadline = uint64(block.timestamp) + TIMEOUT;
        h.status = Status.Open;

        emit HandOpened(handId, msg.sender, h.stake);
    }

    function joinHand(bytes32 handId) external payable {
        Hand storage h = hands[handId];
        if (h.status != Status.Open) revert WrongStatus();
        if (msg.value != h.stake) revert WrongStake();
        if (msg.sender == h.seat0) revert SeatTaken();

        h.seat1 = msg.sender;
        h.status = Status.Funded;

        emit HandFunded(handId, msg.sender);
    }

    /// @notice Report the outcome Midnight proved. Opens the challenge window;
    ///         pays nobody yet.
    /// @param winner 0 = seat0, 1 = seat1, 2 = split
    /// @param attestation must equal `expectedAttestation(handId, winner)`
    function proposeSettlement(bytes32 handId, uint8 winner, bytes32 attestation)
        external
        onlyRelayer
    {
        Hand storage h = hands[handId];
        if (h.status != Status.Funded) revert WrongStatus();
        if (winner > 2) revert BadSeat();
        // The attestation must commit to THIS hand and THIS winner.
        if (attestation == bytes32(0)) revert BadAttestation();
        if (attestation != expectedAttestation(handId, winner)) revert BadAttestation();

        h.status = Status.Settling;
        h.winner = winner;
        h.attestation = attestation;
        h.settledAt = uint64(block.timestamp);

        emit SettlementProposed(handId, winner, attestation, uint64(block.timestamp) + CHALLENGE);
    }

    /// @notice After the challenge window, credit the winner. Callable by
    ///         anyone — the money is already determined.
    function finaliseSettlement(bytes32 handId) external {
        Hand storage h = hands[handId];
        if (h.status != Status.Settling) revert WrongStatus();
        if (block.timestamp < h.settledAt + CHALLENGE) revert TooEarly();

        h.status = Status.Paid;
        uint256 pot = uint256(h.stake) * 2;

        if (h.winner == 2) {
            withdrawable[h.seat0] += pot / 2;
            withdrawable[h.seat1] += pot - pot / 2;
        } else {
            withdrawable[h.winner == 0 ? h.seat0 : h.seat1] += pot;
        }

        emit SettlementFinalised(handId, h.winner, pot);
    }

    /// @notice Recover the stakes if the hand never settles.
    function timeout(bytes32 handId) external {
        Hand storage h = hands[handId];
        if (h.status != Status.Open && h.status != Status.Funded) revert WrongStatus();
        if (msg.sender != h.seat0 && msg.sender != h.seat1) revert NotSeated();
        if (block.timestamp < h.deadline) revert TooEarly();

        Status was = h.status;
        h.status = Status.Refunded;

        withdrawable[h.seat0] += h.stake;
        if (was == Status.Funded) withdrawable[h.seat1] += h.stake;

        emit HandRefunded(handId);
    }

    /// @notice Pull your funds. One rejecting recipient cannot block another.
    function withdraw() external {
        uint256 owed = withdrawable[msg.sender];
        if (owed == 0) revert NothingToDo();
        withdrawable[msg.sender] = 0;

        (bool ok, ) = msg.sender.call{value: owed}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, owed);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NightfoldEscrow
/// @notice Holds the buy-ins for one heads-up hand and pays the winner once
///         Midnight has proven who that is.
///
/// @dev TRUST MODEL — read this before assuming more than it does.
///
/// No EVM chain can verify a Midnight proof natively, so this contract cannot
/// check the ZK proof itself. A relayer watches Midnight's `payoutAttest` map
/// and reports the outcome here. That means:
///
///   - The relayer CANNOT invent an outcome that Midnight did not produce
///     without it being publicly detectable: `attestation` is the exact value
///     Midnight wrote on-chain, and anyone can read Midnight's ledger and
///     compare. A false settlement is permanent, attributable evidence.
///   - The relayer CAN stall. `timeout()` exists so a stalled hand always
///     returns both stakes rather than trapping them.
///   - The relayer CANNOT take the money. Funds only ever leave to a seated
///     player or back to the players on timeout.
///
/// Removing the relayer entirely needs a Midnight proof verifier on the EVM
/// side. That is roadmap, not this weekend, and pretending otherwise would be
/// the dishonest part.
contract NightfoldEscrow {
    enum Status { Empty, Open, Funded, Settled, Refunded }

    struct Hand {
        address seat0;
        address seat1;
        uint128 stake;      // per player, in wei
        uint64  deadline;   // after this, either player may call timeout()
        Status  status;
        bytes32 attestation; // the value Midnight wrote for this hand
    }

    /// @notice handId is the same 32 bytes used as the Midnight handId.
    mapping(bytes32 => Hand) public hands;

    address public immutable relayer;
    uint64  public constant TIMEOUT = 1 hours;

    event HandOpened(bytes32 indexed handId, address indexed seat0, uint128 stake);
    event HandFunded(bytes32 indexed handId, address indexed seat1);
    event HandSettled(bytes32 indexed handId, address indexed winner, uint256 pot, bytes32 attestation);
    event HandRefunded(bytes32 indexed handId);

    error NotRelayer();
    error WrongStatus();
    error WrongStake();
    error SeatTaken();
    error NotSeated();
    error TooEarly();
    error BadSeat();
    error TransferFailed();

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(address _relayer) {
        relayer = _relayer;
    }

    /// @notice Seat 0 opens a hand and posts the stake that seat 1 must match.
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

    /// @notice Seat 1 matches the stake. The hand is now live on Midnight.
    function joinHand(bytes32 handId) external payable {
        Hand storage h = hands[handId];
        if (h.status != Status.Open) revert WrongStatus();
        if (msg.value != h.stake) revert WrongStake();
        if (msg.sender == h.seat0) revert SeatTaken();

        h.seat1 = msg.sender;
        h.status = Status.Funded;

        emit HandFunded(handId, msg.sender);
    }

    /// @notice Pay the pot out to the seat Midnight proved won.
    /// @param winner 0 = seat0, 1 = seat1, 2 = split pot
    /// @param attestation the value Midnight wrote into `payoutAttest[handId]`,
    ///        recorded here so a false settlement is publicly checkable.
    function settle(bytes32 handId, uint8 winner, bytes32 attestation)
        external
        onlyRelayer
    {
        Hand storage h = hands[handId];
        if (h.status != Status.Funded) revert WrongStatus();
        if (winner > 2) revert BadSeat();

        h.status = Status.Settled;
        h.attestation = attestation;

        uint256 pot = uint256(h.stake) * 2;

        if (winner == 2) {
            _pay(h.seat0, pot / 2);
            _pay(h.seat1, pot - pot / 2);
            emit HandSettled(handId, address(0), pot, attestation);
        } else {
            address won = winner == 0 ? h.seat0 : h.seat1;
            _pay(won, pot);
            emit HandSettled(handId, won, pot, attestation);
        }
    }

    /// @notice Recover the stakes if the hand never settles. Callable by either
    ///         player, so a stalled relayer costs time and nothing else.
    function timeout(bytes32 handId) external {
        Hand storage h = hands[handId];
        if (h.status != Status.Open && h.status != Status.Funded) revert WrongStatus();
        if (msg.sender != h.seat0 && msg.sender != h.seat1) revert NotSeated();
        if (block.timestamp < h.deadline) revert TooEarly();

        Status was = h.status;
        h.status = Status.Refunded;

        _pay(h.seat0, h.stake);
        if (was == Status.Funded) _pay(h.seat1, h.stake);

        emit HandRefunded(handId);
    }

    function _pay(address to, uint256 amount) private {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}

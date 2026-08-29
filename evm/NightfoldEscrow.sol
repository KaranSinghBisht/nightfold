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
    enum Status { Empty, Open, Funded, Settling, Disputed, Paid, Refunded }

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
    error BadSignatures();
    error NotAdmin();

    address public admin;
    mapping(address => bool) public isWatcher;
    uint256 public watcherCount;
    uint256 public threshold;

    event Challenged(bytes32 indexed handId, address indexed by);
    event WatchersSet(uint256 count, uint256 threshold);

    /// @dev Signers must arrive in ascending address order, so one watcher
    ///      submitted three times cannot pass for a quorum.
    function _requireQuorum(bytes32 digest, bytes[] calldata sigs) private view {
        if (threshold == 0 || sigs.length < threshold) revert BadSignatures();
        bytes32 signed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        address last = address(0);
        for (uint256 i = 0; i < sigs.length; i++) {
            bytes calldata sig = sigs[i];
            if (sig.length != 65) revert BadSignatures();
            bytes32 r;
            bytes32 s;
            uint8 v;
            assembly {
                r := calldataload(sig.offset)
                s := calldataload(add(sig.offset, 32))
                v := byte(0, calldataload(add(sig.offset, 64)))
            }
            if (v < 27) v += 27;
            if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
                revert BadSignatures();
            }
            address who = ecrecover(signed, v, r, s);
            if (who == address(0) || who <= last || !isWatcher[who]) revert BadSignatures();
            last = who;
        }
    }

    function setWatchers(address[] calldata watchers, uint256 newThreshold) external {
        if (msg.sender != admin) revert NotAdmin();
        for (uint256 i = 0; i < watchers.length; i++) {
            if (watchers[i] == address(0)) revert BadAttestation();
            if (!isWatcher[watchers[i]]) { isWatcher[watchers[i]] = true; watcherCount++; }
        }
        if (newThreshold == 0 || newThreshold > watcherCount) revert BadAttestation();
        threshold = newThreshold;
        emit WatchersSet(watcherCount, newThreshold);
    }

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(address _relayer) {
        if (_relayer == address(0)) revert BadAttestation();
        admin = msg.sender;
        relayer = _relayer;
    }

    /// @notice The bytes a settlement must be signed over.
    ///
    /// @dev RA-002: this used to be `expectedAttestation`, a PURE function of
    ///      (handId, winner) that the contract then compared against a value
    ///      the relayer supplied. Recomputing a hash of relayer-controlled
    ///      inputs is not verification — the relayer picked a winner, called
    ///      this, and handed back its own answer. An auditor took the whole pot
    ///      that way.
    ///
    ///      It is still a pure function, because it has to be checkable by
    ///      anyone. What changed is that knowing it is no longer sufficient:
    ///      the settlement needs signatures over it from a quorum the relayer
    ///      is not a member of. The chain id and this address are inside the
    ///      digest so a signature cannot be lifted to another deployment.
    function settleDigest(bytes32 handId, uint8 winner) public view returns (bytes32) {
        return keccak256(abi.encode("nf:settle:v1", block.chainid, address(this), handId, winner));
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
    /// @param sigs watcher signatures over `settleDigest(handId, winner)`
    function proposeSettlement(bytes32 handId, uint8 winner, bytes[] calldata sigs)
        external
        onlyRelayer
    {
        Hand storage h = hands[handId];
        if (h.status != Status.Funded) revert WrongStatus();
        if (winner > 2) revert BadSeat();

        bytes32 digest = settleDigest(handId, winner);
        _requireQuorum(digest, sigs);

        h.status = Status.Settling;
        h.winner = winner;
        h.attestation = digest;
        h.settledAt = uint64(block.timestamp);

        emit SettlementProposed(handId, winner, digest, uint64(block.timestamp) + CHALLENGE);
    }

    /// @notice Dispute a proposed settlement.
    ///
    /// @dev RA-002 again: there was a ten-minute "challenge window" and no way
    ///      to challenge in it, so a false proposal became an inevitable payout
    ///      by simply waiting. Either seat can now stop one.
    ///
    ///      This does not decide who was right — nothing on this chain can, and
    ///      pretending otherwise is how the last version went wrong. It moves
    ///      the hand to Disputed, from which the stakes are refundable after
    ///      the deadline. A liar cannot be paid; both players get their money
    ///      back and the disagreement is settled off-chain.
    function challenge(bytes32 handId) external {
        Hand storage h = hands[handId];
        if (h.status != Status.Settling) revert WrongStatus();
        if (msg.sender != h.seat0 && msg.sender != h.seat1) revert NotSeated();
        if (block.timestamp >= h.settledAt + CHALLENGE) revert TooEarly();

        h.status = Status.Disputed;
        emit Challenged(handId, msg.sender);
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
    /// @dev Reachable from Disputed too. Without that, a challenged hand would
    ///      simply be stuck — which is a worse failure than a refund, and was
    ///      the other half of why the old challenge window was decorative.
    function timeout(bytes32 handId) external {
        Hand storage h = hands[handId];
        if (h.status != Status.Open && h.status != Status.Funded && h.status != Status.Disputed) {
            revert WrongStatus();
        }
        if (msg.sender != h.seat0 && msg.sender != h.seat1) revert NotSeated();
        if (block.timestamp < h.deadline) revert TooEarly();

        Status was = h.status;
        h.status = Status.Refunded;

        withdrawable[h.seat0] += h.stake;
        if (was == Status.Funded || was == Status.Disputed) withdrawable[h.seat1] += h.stake;

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

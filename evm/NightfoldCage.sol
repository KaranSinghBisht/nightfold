// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NightfoldCage
/// @notice The cage: where you buy chips and where you cash them out.
///
/// A poker room does not let you bet ETH against SOL — you buy chips at the
/// cage, play in chips, and cash out in whatever you want. That is what makes
/// Nightfold genuinely cross-chain rather than two escrows side by side:
///
///     buy in with ETH on Base  ─┐
///                               ├─→  CHIPS  ─→  cash out in SOL on Solana
///     buy in with SOL on Solana─┘
///
/// @dev SECURITY MODEL — rewritten after the 2026-08-29 audit (NF-001).
///
/// The first version let the relayer name any recipient and any amount, with
/// no chip ledger behind it. That is a drain: a compromised relayer emptied a
/// funded cage in one call, with no deposit and no game. This version fixes
/// the shape of the authority rather than adding a check to it.
///
///   - There is a real CHIP LEDGER. Chips exist only where they were credited,
///     and cashing out BURNS them. `totalChips` is a conservation invariant.
///   - The relayer can only CREDIT, and only against a recorded provenance
///     `(sourceChainId, sourceDepositId)` that is globally replay-protected.
///     It cannot mint to itself silently: every credit is an event naming the
///     source deposit anyone can check on that chain.
///   - Credits are bounded per epoch, so a compromised relayer's blast radius
///     is capped and observable rather than "all liquidity, instantly".
///   - The relayer CANNOT move funds. Withdrawal is initiated by the chip
///     HOLDER, who can only burn chips they actually own.
///   - Payouts are PULL, not push (NF-008): a recipient that rejects transfers
///     can no longer wedge anyone else's money.
contract NightfoldCage {
    /// @notice chips per 1e18 wei of the native asset. Published, not secret.
    ///         When no oracle is set this is the rate, fixed for the life of
    ///         the cage. When one is set this is the rate it launched at, kept
    ///         for reference, and `rate()` is what actually prices a buy-in.
    uint256 public immutable chipsPerToken;

    /// @notice Optional price source.
    ///
    /// A chip is the unit of account, so every chain's rate has to be derived
    /// from ONE view of what things are worth. If the rates disagree the
    /// disagreement is free money: buy chips where they are cheap and cash out
    /// where they are dear. A fixed rate cannot disagree on day one and cannot
    /// help but disagree by day thirty, which is what this exists for.
    ///
    /// Unset (address(0)) keeps the launch rate forever — fine for a cage whose
    /// life is one session, and it is the behaviour every existing deployment
    /// has.
    address public immutable oracle;

    uint256 private livePrice;
    uint64 public priceUpdatedAt;

    /// @notice A price older than this cannot mint chips. It can still redeem
    ///         them — see `exitRate()`.
    uint64 public constant MAX_PRICE_AGE = 1 hours;
    /// @notice Largest single move the oracle may post, in basis points. Caps
    ///         what a compromised oracle can do in one transaction, and makes a
    ///         run of them visible on chain rather than instant.
    uint256 public constant MAX_MOVE_BPS = 2_000;
    address public immutable relayer;
    uint64 public constant RECLAIM_AFTER = 2 hours;

    /// @notice Max chips the relayer may credit per epoch. Caps a key compromise.
    uint256 public immutable creditCapPerEpoch;
    uint64 public constant EPOCH = 1 hours;

    struct Deposit {
        address player;
        uint128 amount;
        uint64 depositedAt;
        bool credited;
        bool reclaimed;
    }

    mapping(bytes32 => Deposit) public deposits;

    /// @notice The chip ledger. Chips exist here or they do not exist.
    mapping(address => uint256) public chips;
    /// @notice Conservation invariant: the cage never owes more than this.
    uint256 public totalChips;

    /// @notice Global replay protection over (sourceChainId, sourceDepositId).
    mapping(bytes32 => bool) public creditedProvenance;

    /// @notice Pull-payment balances (NF-008).
    mapping(address => uint256) public withdrawable;

    mapping(uint64 => uint256) public creditedInEpoch;

    event BoughtIn(bytes32 indexed depositId, address indexed player, uint128 amount, uint256 chips);
    event Credited(address indexed player, uint256 chips, uint256 sourceChainId, bytes32 sourceDepositId);
    event CashedOut(address indexed player, uint256 chips, uint256 amount);
    event Reclaimed(bytes32 indexed depositId, address indexed player, uint128 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event RatePosted(uint256 chipsPerToken, uint256 postedAt);

    error NotRelayer();
    error AlreadyUsed();
    error NothingToDo();
    error TooEarly();
    error NotYours();
    error EmptyDeposit();
    error CageEmpty();
    error TransferFailed();
    error NotOracle();
    error PriceStale();
    error PriceJump();
    error InsufficientChips();
    error EpochCapExceeded();

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(
        address _relayer,
        uint256 _chipsPerToken,
        uint256 _creditCapPerEpoch,
        address _oracle
    ) {
        relayer = _relayer;
        chipsPerToken = _chipsPerToken;
        creditCapPerEpoch = _creditCapPerEpoch;
        oracle = _oracle;
        livePrice = _chipsPerToken;
        priceUpdatedAt = uint64(block.timestamp);
    }

    // ---- pricing -----------------------------------------------------------

    /// @notice The rate that prices a buy-in right now. Reverts on a stale
    ///         price rather than minting chips against a number nobody stands
    ///         behind.
    function rate() public view returns (uint256) {
        if (oracle == address(0)) return chipsPerToken;
        if (block.timestamp - priceUpdatedAt > MAX_PRICE_AGE) revert PriceStale();
        return livePrice;
    }

    /// @notice The rate that prices a cash-out. Deliberately does NOT check
    ///         staleness: a cage that cannot price should stop taking money in,
    ///         but trapping chips already bought is the worse failure. An
    ///         attacker cannot stop the oracle to reach this path, so the
    ///         exposure is a stale rate on the way out, not a stuck balance.
    function exitRate() public view returns (uint256) {
        return oracle == address(0) ? chipsPerToken : livePrice;
    }

    function postRate(uint256 newChipsPerToken) external {
        if (msg.sender != oracle) revert NotOracle();
        if (newChipsPerToken == 0) revert NothingToDo();

        uint256 prev = livePrice;
        uint256 move = newChipsPerToken > prev ? newChipsPerToken - prev : prev - newChipsPerToken;
        if (move * 10_000 > prev * MAX_MOVE_BPS) revert PriceJump();

        livePrice = newChipsPerToken;
        priceUpdatedAt = uint64(block.timestamp);
        emit RatePosted(newChipsPerToken, block.timestamp);
    }

    // ---- buying in ---------------------------------------------------------

    /// @notice Buy chips with this chain's native asset.
    function buyIn(bytes32 depositId) external payable {
        if (msg.value == 0) revert EmptyDeposit();
        if (deposits[depositId].player != address(0)) revert AlreadyUsed();

        deposits[depositId] = Deposit({
            player: msg.sender,
            amount: uint128(msg.value),
            depositedAt: uint64(block.timestamp),
            credited: false,
            reclaimed: false
        });

        emit BoughtIn(depositId, msg.sender, uint128(msg.value), chipsFor(msg.value));
    }

    function chipsFor(uint256 amount) public view returns (uint256) {
        return (amount * rate()) / 1e18;
    }

    function tokensFor(uint256 chipAmount) public view returns (uint256) {
        return (chipAmount * 1e18) / exitRate();
    }

    /// @notice Credit chips for a deposit made ON THIS CHAIN.
    function creditLocal(bytes32 depositId) external onlyRelayer {
        Deposit storage d = deposits[depositId];
        if (d.player == address(0) || d.credited || d.reclaimed) revert NothingToDo();

        d.credited = true;
        uint256 amount = chipsFor(d.amount);
        _credit(d.player, amount, block.chainid, depositId);
    }

    /// @notice Credit chips for a deposit made on ANOTHER chain. This is the
    ///         cross-chain leg, and the part the relayer is trusted for — so it
    ///         is bounded, replay-protected, and fully attributable.
    function creditRemote(
        address player,
        uint256 chipAmount,
        uint256 sourceChainId,
        bytes32 sourceDepositId
    ) external onlyRelayer {
        if (sourceChainId == block.chainid) revert NothingToDo();
        _credit(player, chipAmount, sourceChainId, sourceDepositId);
    }

    function _credit(address player, uint256 amount, uint256 sourceChainId, bytes32 sourceDepositId)
        private
    {
        if (player == address(0) || amount == 0) revert NothingToDo();

        bytes32 provenance = keccak256(abi.encode(sourceChainId, sourceDepositId));
        if (creditedProvenance[provenance]) revert AlreadyUsed();
        creditedProvenance[provenance] = true;

        uint64 epoch = uint64(block.timestamp) / EPOCH;
        uint256 used = creditedInEpoch[epoch] + amount;
        if (used > creditCapPerEpoch) revert EpochCapExceeded();
        creditedInEpoch[epoch] = used;

        chips[player] += amount;
        totalChips += amount;

        emit Credited(player, amount, sourceChainId, sourceDepositId);
    }

    // ---- cashing out -------------------------------------------------------

    /// @notice Burn your own chips and queue the proceeds for withdrawal.
    ///         Called by the CHIP HOLDER — the relayer cannot move funds.
    function cashOut(uint256 chipAmount) external {
        if (chipAmount == 0) revert NothingToDo();
        if (chips[msg.sender] < chipAmount) revert InsufficientChips();

        uint256 owed = tokensFor(chipAmount);
        if (owed == 0) revert NothingToDo();
        if (owed > address(this).balance) revert CageEmpty();

        chips[msg.sender] -= chipAmount;
        totalChips -= chipAmount;
        withdrawable[msg.sender] += owed;

        emit CashedOut(msg.sender, chipAmount, owed);
    }

    /// @notice Recover a deposit the relayer never credited.
    function reclaim(bytes32 depositId) external {
        Deposit storage d = deposits[depositId];
        if (d.player != msg.sender) revert NotYours();
        if (d.credited || d.reclaimed) revert NothingToDo();
        if (block.timestamp < d.depositedAt + RECLAIM_AFTER) revert TooEarly();

        d.reclaimed = true;
        withdrawable[d.player] += d.amount;
        emit Reclaimed(depositId, d.player, d.amount);
    }

    /// @notice Pull your funds. Isolated so one rejecting recipient cannot
    ///         block anybody else (NF-008).
    function withdraw() external {
        uint256 owed = withdrawable[msg.sender];
        if (owed == 0) revert NothingToDo();
        withdrawable[msg.sender] = 0;

        (bool ok, ) = msg.sender.call{value: owed}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, owed);
    }

    /// @notice House float, so a cage can pay out chips bought elsewhere.
    function fund() external payable {}
}

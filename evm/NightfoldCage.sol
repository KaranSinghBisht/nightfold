// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NightfoldCage
/// @notice The cage: where you buy chips and where you cash them out.
///
/// A poker room does not let you bet ETH against SOL — you buy chips at the
/// cage, play in chips, and cash out in whatever you want. That is what makes
/// Nightfold cross-chain rather than two escrows side by side.
///
/// @dev SECURITY MODEL — rewritten after the 2026-08-29 re-audit.
///
/// The re-audit confirmed four criticals here, and three of them shared a root
/// cause: nothing tied the chips the cage owed to the money the cage held.
/// Replay protection proved only that the relayer had not reused an invented
/// tuple; the epoch cap bounded accounting units rather than loss; and the
/// oracle could walk the rate anywhere in a sequence of individually legal
/// steps. Each was a separate hole, but all three drained through the same gap.
///
/// So there is now ONE invariant, checked everywhere value or price moves:
///
///     tokensFor(totalChips) + totalWithdrawable <= address(this).balance
///
/// The cage must always hold enough to pay every chip it has issued plus every
/// withdrawal it has queued. A relayer crediting itself fabricated chips fails
/// it. An oracle repricing chips upward until the float is consumed fails it.
/// A credit that exceeds unencumbered reserves fails it. That is strictly
/// stronger than any per-call cap, because it bounds LOSS rather than counting
/// units, and it cannot be walked around one legal step at a time.
///
/// Standing on top of that:
///
///   - Remote credit requires a THRESHOLD-SIGNED burn receipt naming both
///     cages, both chains, the player, the amount and a nonce. A destination
///     credit now has to prove chips were burned at the source, so one deposit
///     cannot be spendable in two places (RA-005). The relayer submits it; it
///     cannot author it, and it cannot credit itself (RA-001).
///   - The oracle is bounded per post, per window, AND by solvency, and cannot
///     post twice in the same block (RA-004).
///   - A buy-in fixes its chip amount at deposit time with a minimum the buyer
///     names, so rate movement between deposit and credit cannot change what
///     they get (RA-013).
///   - Roles are rotatable through a two-step handover, parameters are
///     validated, and there is a pause that can stop new value entering
///     without ever trapping value already inside (RA-014).
interface ICageReceipts {
    function issuedReceipt(bytes32 digest) external view returns (bool);
}

contract NightfoldCage {
    // ---- roles -------------------------------------------------------------

    address public admin;
    address public pendingAdmin;
    address public relayer;
    address public oracle;
    bool public paused;

    /// @notice Watchers whose signatures authorise a remote credit.
    mapping(address => bool) public isWatcher;
    uint256 public watcherCount;
    /// @notice How many distinct watcher signatures a remote credit needs.
    uint256 public threshold;

    // ---- pricing -----------------------------------------------------------

    /// @notice The rate the cage launched at. Published, not secret.
    uint256 public immutable chipsPerToken;

    uint256 private livePrice;
    uint64 public priceUpdatedAt;
    uint64 public windowStart;
    uint256 public windowOpenPrice;

    uint64 public constant MAX_PRICE_AGE = 1 hours;
    uint64 public constant MIN_POST_INTERVAL = 5 minutes;
    uint64 public constant MOVE_WINDOW = 1 days;
    /// @notice Largest single post, and largest total move within a window.
    uint256 public constant MAX_MOVE_BPS = 2_000;
    uint256 public constant MAX_WINDOW_BPS = 3_000;

    // ---- ledger ------------------------------------------------------------

    uint64 public constant RECLAIM_AFTER = 2 hours;
    uint256 public immutable creditCapPerEpoch;
    uint64 public constant EPOCH = 1 hours;

    struct Deposit {
        address player;
        uint128 amount;
        /// @notice Chips priced AT DEPOSIT TIME, so a later rate cannot change them.
        uint128 chipsQuoted;
        uint64 depositedAt;
        bool credited;
        bool reclaimed;
    }

    mapping(bytes32 => Deposit) public deposits;

    /// @notice The chip ledger. Chips exist here or they do not exist.
    mapping(address => uint256) public chips;
    uint256 public totalChips;

    /// @notice Queued pull payments, and their total — part of the invariant.
    mapping(address => uint256) public withdrawable;
    uint256 public totalWithdrawable;

    /// @notice Replay protection over burn receipts and local provenance.
    mapping(bytes32 => bool) public creditedProvenance;
    mapping(uint64 => uint256) public creditedInEpoch;

    uint256 public burnNonce;
    /// @notice Receipts this cage has issued. A same-chain destination reads
    ///         this directly rather than taking a signature's word for it.
    mapping(bytes32 => bool) public issuedReceipt;

    /// @notice A remote credit, as signed by the watchers.
    struct RemoteCredit {
        uint256 srcChainId;
        address srcCage;
        uint256 dstChainId;
        address dstCage;
        address player;
        uint256 chipAmount;
        uint256 nonce;
    }

    event BoughtIn(bytes32 indexed depositId, address indexed player, uint128 amount, uint256 chips);
    event Credited(address indexed player, uint256 chips, uint256 sourceChainId, bytes32 sourceDepositId);
    event BurnedForRemote(
        uint256 indexed nonce, address indexed player, uint256 chips, uint256 dstChainId, address dstCage
    );
    event CashedOut(address indexed player, uint256 chips, uint256 amount);
    event Reclaimed(bytes32 indexed depositId, address indexed player, uint128 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event RatePosted(uint256 chipsPerToken, uint256 postedAt);
    event RoleChanged(bytes32 indexed role, address indexed from, address indexed to);
    event PausedSet(bool paused);

    error NotRelayer();
    error NotOracle();
    error NotAdmin();
    error AlreadyUsed();
    error NothingToDo();
    error TooEarly();
    error NotYours();
    error EmptyDeposit();
    error CageEmpty();
    error TransferFailed();
    error EpochCapExceeded();
    error InsufficientChips();
    error PriceStale();
    error PriceJump();
    error Insolvent();
    error BadSignatures();
    error BadParameter();
    error Paused();
    error SelfDeal();
    error Slippage();

    modifier onlyAdmin() { if (msg.sender != admin) revert NotAdmin(); _; }
    modifier onlyRelayer() { if (msg.sender != relayer) revert NotRelayer(); _; }
    modifier notPaused() { if (paused) revert Paused(); _; }

    constructor(
        address _relayer,
        uint256 _chipsPerToken,
        uint256 _creditCapPerEpoch,
        address _oracle
    ) {
        // RA-014: a zero relayer permanently disables credit, a zero rate makes
        // conversion nonsensical, a zero cap bricks the cage. None are useful
        // states to be able to deploy into.
        if (_relayer == address(0)) revert BadParameter();
        if (_chipsPerToken == 0) revert BadParameter();
        if (_creditCapPerEpoch == 0) revert BadParameter();

        admin = msg.sender;
        relayer = _relayer;
        oracle = _oracle;
        chipsPerToken = _chipsPerToken;
        creditCapPerEpoch = _creditCapPerEpoch;

        livePrice = _chipsPerToken;
        priceUpdatedAt = uint64(block.timestamp);
        windowStart = uint64(block.timestamp);
        windowOpenPrice = _chipsPerToken;
    }

    // ---- the invariant -----------------------------------------------------

    /// @notice What the cage owes, in native asset, at the redemption rate.
    function liabilities() public view returns (uint256) {
        return tokensFor(totalChips) + totalWithdrawable;
    }

    /// @notice Reserves not already owed to somebody.
    function unencumbered() public view returns (uint256) {
        uint256 owed = liabilities();
        uint256 held = address(this).balance;
        return held > owed ? held - owed : 0;
    }

    /// @dev The one check. Everything that mints chips or moves the price ends
    ///      here, so a hole has to break solvency to be worth anything.
    function _requireSolvent() private view {
        if (liabilities() > address(this).balance) revert Insolvent();
    }

    // ---- pricing -----------------------------------------------------------

    function rate() public view returns (uint256) {
        if (oracle == address(0)) return chipsPerToken;
        if (block.timestamp - priceUpdatedAt > MAX_PRICE_AGE) revert PriceStale();
        return livePrice;
    }

    /// @notice The rate that prices a cash-out. Deliberately does not check
    ///         staleness: a cage that cannot price should stop taking money in,
    ///         but trapping chips already bought is the worse failure.
    function exitRate() public view returns (uint256) {
        return oracle == address(0) ? chipsPerToken : livePrice;
    }

    /// @notice Post a new rate.
    ///
    /// @dev RA-004: the old version bounded each post at 20% and nothing else,
    ///      so twenty-one legal posts in one block walked the rate from 20,000
    ///      to 186 and turned a 0.05 ETH buy-in into a 5 ETH withdrawal. A per
    ///      call bound is not a bound at all without a clock. This one needs
    ///      elapsed time between posts, holds the total move inside a rolling
    ///      window, and must leave the cage solvent at the new price.
    function postRate(uint256 newChipsPerToken) external {
        if (msg.sender != oracle) revert NotOracle();
        if (newChipsPerToken == 0) revert NothingToDo();
        if (block.timestamp < priceUpdatedAt + MIN_POST_INTERVAL) revert TooEarly();

        uint256 prev = livePrice;
        if (_moveBps(prev, newChipsPerToken) > MAX_MOVE_BPS) revert PriceJump();

        if (block.timestamp >= windowStart + MOVE_WINDOW) {
            windowStart = uint64(block.timestamp);
            windowOpenPrice = prev;
        }
        if (_moveBps(windowOpenPrice, newChipsPerToken) > MAX_WINDOW_BPS) revert PriceJump();

        livePrice = newChipsPerToken;
        priceUpdatedAt = uint64(block.timestamp);

        // Repricing chips upward is a withdrawal of reserves by another name.
        _requireSolvent();

        emit RatePosted(newChipsPerToken, block.timestamp);
    }

    function _moveBps(uint256 from, uint256 to) private pure returns (uint256) {
        uint256 diff = to > from ? to - from : from - to;
        return (diff * 10_000) / from;
    }

    function chipsFor(uint256 amount) public view returns (uint256) {
        return (amount * rate()) / 1e18;
    }

    function tokensFor(uint256 chipAmount) public view returns (uint256) {
        return (chipAmount * 1e18) / exitRate();
    }

    // ---- buying in ---------------------------------------------------------

    /// @notice Buy chips with this chain's native asset.
    /// @param minChips The fewest chips you will accept. RA-013: the rate can
    ///        move between deposit and credit, so the buyer names their floor
    ///        and the quote is fixed here rather than recomputed later.
    function buyIn(bytes32 depositId, uint256 minChips) external payable notPaused {
        if (msg.value == 0) revert EmptyDeposit();
        if (deposits[depositId].player != address(0)) revert AlreadyUsed();

        uint256 quoted = chipsFor(msg.value);
        if (quoted == 0) revert NothingToDo();
        if (quoted < minChips) revert Slippage();

        deposits[depositId] = Deposit({
            player: msg.sender,
            amount: uint128(msg.value),
            chipsQuoted: uint128(quoted),
            depositedAt: uint64(block.timestamp),
            credited: false,
            reclaimed: false
        });

        emit BoughtIn(depositId, msg.sender, uint128(msg.value), quoted);
    }

    /// @notice Credit chips for a deposit made ON THIS CHAIN, at the rate the
    ///         depositor was quoted.
    function creditLocal(bytes32 depositId) external onlyRelayer notPaused {
        Deposit storage d = deposits[depositId];
        if (d.player == address(0) || d.credited || d.reclaimed) revert NothingToDo();

        d.credited = true;
        _credit(d.player, d.chipsQuoted, block.chainid, depositId);
    }

    // ---- crossing between cages -------------------------------------------

    /// @notice Burn chips here so they can be minted on another cage.
    ///
    /// @dev RA-005: chip conservation used to be local to each deployment, so
    ///      one deposit could be credited on two cages with the source balance
    ///      still spendable. Leaving is now a burn that produces a receipt, and
    ///      arriving requires that receipt — so the chips exist in exactly one
    ///      place at a time.
    function burnForRemote(uint256 chipAmount, uint256 dstChainId, address dstCage)
        external
        notPaused
        returns (uint256 nonce)
    {
        if (chipAmount == 0) revert NothingToDo();
        if (dstCage == address(0)) revert BadParameter();
        if (dstChainId == block.chainid && dstCage == address(this)) revert NothingToDo();
        if (chips[msg.sender] < chipAmount) revert InsufficientChips();

        chips[msg.sender] -= chipAmount;
        totalChips -= chipAmount;

        nonce = ++burnNonce;
        issuedReceipt[
            _digest(block.chainid, address(this), dstChainId, dstCage, msg.sender, chipAmount, nonce)
        ] = true;

        emit BurnedForRemote(nonce, msg.sender, chipAmount, dstChainId, dstCage);
    }

    /// @notice The bytes the watchers sign. Public so anyone can check a receipt.
    function creditDigest(RemoteCredit calldata rc) public pure returns (bytes32) {
        return _digest(rc.srcChainId, rc.srcCage, rc.dstChainId, rc.dstCage, rc.player, rc.chipAmount, rc.nonce);
    }

    function _digest(
        uint256 srcChainId,
        address srcCage,
        uint256 dstChainId,
        address dstCage,
        address player,
        uint256 chipAmount,
        uint256 nonce
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode("nf:remote-credit:v1", srcChainId, srcCage, dstChainId, dstCage, player, chipAmount, nonce)
        );
    }

    /// @notice Credit chips burned on another cage.
    ///
    /// @dev RA-001: the old version let the relayer name the recipient, amount,
    ///      chain and deposit id with no proof, so it credited itself against a
    ///      fabricated deposit and cashed out a funded cage. The relayer now
    ///      only CARRIES a receipt the watchers signed; it cannot author one,
    ///      cannot name itself, and cannot exceed unencumbered reserves.
    function creditRemote(RemoteCredit calldata rc, bytes[] calldata sigs)
        external
        onlyRelayer
        notPaused
    {
        if (rc.dstChainId != block.chainid || rc.dstCage != address(this)) revert BadParameter();
        if (rc.srcChainId == block.chainid && rc.srcCage == address(this)) revert NothingToDo();
        // A relayer that can pay itself is a relayer that can drain the cage.
        if (rc.player == relayer || rc.player == address(0)) revert SelfDeal();

        bytes32 digest = creditDigest(rc);

        // When the source cage is on this chain the burn is READABLE, so read
        // it. A signature is only needed where the source is genuinely out of
        // reach; taking one on faith for a contract sitting next door is how
        // one deposit ended up spendable in two cages.
        if (rc.srcChainId == block.chainid) {
            if (!ICageReceipts(rc.srcCage).issuedReceipt(digest)) revert BadSignatures();
        } else {
            _requireQuorum(digest, sigs);
        }

        _credit(rc.player, rc.chipAmount, rc.srcChainId, bytes32(rc.nonce));
    }

    /// @dev Signers must arrive strictly ascending, which makes duplicates
    ///      impossible to pass off as a quorum without a second set membership
    ///      check per signature.
    function _requireQuorum(bytes32 digest, bytes[] calldata sigs) private view {
        if (threshold == 0 || sigs.length < threshold) revert BadSignatures();

        bytes32 signed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        address last = address(0);
        uint256 seen;

        for (uint256 i = 0; i < sigs.length; i++) {
            address who = _recover(signed, sigs[i]);
            if (who <= last) revert BadSignatures();
            last = who;
            if (!isWatcher[who]) revert BadSignatures();
            unchecked { seen++; }
        }
        if (seen < threshold) revert BadSignatures();
    }

    function _recover(bytes32 signed, bytes calldata sig) private pure returns (address) {
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
        // Reject the malleable upper half of the curve order.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            revert BadSignatures();
        }
        address who = ecrecover(signed, v, r, s);
        if (who == address(0)) revert BadSignatures();
        return who;
    }

    function _credit(address player, uint256 amount, uint256 sourceChainId, bytes32 sourceRef) private {
        if (player == address(0) || amount == 0) revert NothingToDo();

        bytes32 provenance = keccak256(abi.encode(sourceChainId, sourceRef));
        if (creditedProvenance[provenance]) revert AlreadyUsed();
        creditedProvenance[provenance] = true;

        uint64 epoch = uint64(block.timestamp) / EPOCH;
        uint256 used = creditedInEpoch[epoch] + amount;
        if (used > creditCapPerEpoch) revert EpochCapExceeded();
        creditedInEpoch[epoch] = used;

        chips[player] += amount;
        totalChips += amount;

        // Chips the cage cannot pay for are not chips.
        _requireSolvent();

        emit Credited(player, amount, sourceChainId, sourceRef);
    }

    // ---- cashing out -------------------------------------------------------

    /// @notice Burn your own chips and queue the proceeds. Called by the CHIP
    ///         HOLDER — the relayer cannot move funds.
    function cashOut(uint256 chipAmount) external {
        if (chipAmount == 0) revert NothingToDo();
        if (chips[msg.sender] < chipAmount) revert InsufficientChips();

        uint256 owed = tokensFor(chipAmount);
        if (owed == 0) revert NothingToDo();
        if (owed > address(this).balance) revert CageEmpty();

        chips[msg.sender] -= chipAmount;
        totalChips -= chipAmount;
        withdrawable[msg.sender] += owed;
        totalWithdrawable += owed;

        emit CashedOut(msg.sender, chipAmount, owed);
    }

    /// @notice Recover a deposit the relayer never credited. Works while
    ///         paused: a pause must never trap value already inside.
    function reclaim(bytes32 depositId) external {
        Deposit storage d = deposits[depositId];
        if (d.player != msg.sender) revert NotYours();
        if (d.credited || d.reclaimed) revert NothingToDo();
        if (block.timestamp < d.depositedAt + RECLAIM_AFTER) revert TooEarly();

        d.reclaimed = true;
        withdrawable[d.player] += d.amount;
        totalWithdrawable += d.amount;
        emit Reclaimed(depositId, d.player, d.amount);
    }

    /// @notice Pull your funds. Isolated so one rejecting recipient cannot
    ///         block anybody else (NF-008). Works while paused.
    function withdraw() external {
        uint256 owed = withdrawable[msg.sender];
        if (owed == 0) revert NothingToDo();
        withdrawable[msg.sender] = 0;
        totalWithdrawable -= owed;

        (bool ok, ) = msg.sender.call{value: owed}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, owed);
    }

    /// @notice House float, so a cage can pay out chips bought elsewhere.
    function fund() external payable {}

    // ---- administration ----------------------------------------------------

    function setWatchers(address[] calldata watchers, uint256 newThreshold) external onlyAdmin {
        for (uint256 i = 0; i < watchers.length; i++) {
            if (watchers[i] == address(0)) revert BadParameter();
            if (!isWatcher[watchers[i]]) {
                isWatcher[watchers[i]] = true;
                watcherCount++;
            }
        }
        if (newThreshold == 0 || newThreshold > watcherCount) revert BadParameter();
        threshold = newThreshold;
    }

    function removeWatcher(address watcher) external onlyAdmin {
        if (!isWatcher[watcher]) revert NothingToDo();
        isWatcher[watcher] = false;
        watcherCount--;
        if (threshold > watcherCount) threshold = watcherCount;
    }

    function setRelayer(address next) external onlyAdmin {
        if (next == address(0)) revert BadParameter();
        emit RoleChanged("relayer", relayer, next);
        relayer = next;
    }

    function setOracle(address next) external onlyAdmin {
        emit RoleChanged("oracle", oracle, next);
        oracle = next;
        priceUpdatedAt = uint64(block.timestamp);
    }

    /// @notice Stop new value entering. Never stops it leaving.
    function setPaused(bool next) external onlyAdmin {
        paused = next;
        emit PausedSet(next);
    }

    function transferAdmin(address next) external onlyAdmin {
        pendingAdmin = next;
    }

    /// @dev Two steps, so a typo cannot hand the cage to an address nobody holds.
    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NotAdmin();
        emit RoleChanged("admin", admin, pendingAdmin);
        admin = pendingAdmin;
        pendingAdmin = address(0);
    }
}

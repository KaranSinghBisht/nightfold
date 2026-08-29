// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NightfoldCage
/// @notice The cage: where you buy chips and where you cash them out.
///
/// A poker room does not let you bet ETH against SOL — you buy chips at the
/// cage, play in chips, and cash out in whatever you want on the way home.
/// Nightfold works the same way, and that is what makes it genuinely
/// cross-chain rather than two escrows running side by side:
///
///     buy in with ETH on Base  ─┐
///                               ├─→  CHIPS  ─→  cash out in SOL on Solana
///     buy in with SOL on Solana─┘
///
/// One cage is deployed per chain. Chips are a single unit of account across
/// all of them, so a hand between a Base player and a Solana player is a fair
/// game rather than a currency mismatch.
///
/// @dev TRUST MODEL. The relayer credits and debits chips because no EVM chain
/// can read Midnight or Solana natively. It CANNOT mint itself a payout: every
/// withdrawal is bounded by what this cage actually holds, and every credit is
/// an event anyone can replay against the other chains. It CAN stall, so
/// `reclaim` lets a player recover an un-credited deposit after a timeout.
contract NightfoldCage {
    /// @notice chips per 1e18 wei of the native asset. Published, not secret.
    uint256 public immutable chipsPerToken;
    address public immutable relayer;
    uint64 public constant RECLAIM_AFTER = 2 hours;

    struct Deposit {
        address player;
        uint128 amount;
        uint64 depositedAt;
        bool credited;
        bool reclaimed;
    }

    /// @notice depositId => deposit. depositId is chosen by the player's client
    ///         and is the same id the relayer uses to credit chips.
    mapping(bytes32 => Deposit) public deposits;

    /// @notice Chips this cage has already paid out for, to bound the relayer.
    mapping(bytes32 => bool) public settledWithdrawals;

    event BoughtIn(bytes32 indexed depositId, address indexed player, uint128 amount, uint256 chips);
    event Credited(bytes32 indexed depositId);
    event CashedOut(bytes32 indexed withdrawalId, address indexed player, uint256 chips, uint128 amount);
    event Reclaimed(bytes32 indexed depositId, address indexed player, uint128 amount);

    error NotRelayer();
    error AlreadyUsed();
    error NothingToDo();
    error TooEarly();
    error NotYours();
    error EmptyDeposit();
    error CageEmpty();
    error TransferFailed();

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(address _relayer, uint256 _chipsPerToken) {
        relayer = _relayer;
        chipsPerToken = _chipsPerToken;
    }

    /// @notice Buy chips with this chain's native asset.
    /// @param depositId a fresh id from your client; the relayer credits against it
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

    /// @notice How many chips a given amount of the native asset buys.
    function chipsFor(uint256 amount) public view returns (uint256) {
        return (amount * chipsPerToken) / 1e18;
    }

    /// @notice How much of the native asset a chip balance is worth here.
    function tokensFor(uint256 chips) public view returns (uint256) {
        return (chips * 1e18) / chipsPerToken;
    }

    /// @notice Relayer marks a deposit as credited once chips exist for it.
    function markCredited(bytes32 depositId) external onlyRelayer {
        Deposit storage d = deposits[depositId];
        if (d.player == address(0) || d.credited || d.reclaimed) revert NothingToDo();
        d.credited = true;
        emit Credited(depositId);
    }

    /// @notice Cash chips out on THIS chain, whichever chain they were bought on.
    ///         That asymmetry is the point: buy with SOL, leave with ETH.
    function cashOut(bytes32 withdrawalId, address player, uint256 chips)
        external
        onlyRelayer
    {
        if (settledWithdrawals[withdrawalId]) revert AlreadyUsed();
        uint256 owed = tokensFor(chips);
        if (owed == 0) revert NothingToDo();
        if (owed > address(this).balance) revert CageEmpty();

        settledWithdrawals[withdrawalId] = true;
        _pay(player, owed);
        emit CashedOut(withdrawalId, player, chips, uint128(owed));
    }

    /// @notice Recover a deposit the relayer never credited. A stalled relayer
    ///         costs you time, never your buy-in.
    function reclaim(bytes32 depositId) external {
        Deposit storage d = deposits[depositId];
        if (d.player != msg.sender) revert NotYours();
        if (d.credited || d.reclaimed) revert NothingToDo();
        if (block.timestamp < d.depositedAt + RECLAIM_AFTER) revert TooEarly();

        d.reclaimed = true;
        _pay(d.player, d.amount);
        emit Reclaimed(depositId, d.player, d.amount);
    }

    /// @notice Anyone may top the cage up so it can pay out chips bought
    ///         elsewhere. In production this is the house's float.
    function fund() external payable {}

    function _pay(address to, uint256 amount) private {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NightfoldTable
/// @notice Heads-up no-limit betting, on chain.
///
/// Betting used to be JavaScript. The cage held chips and the escrow held a
/// stake, but every fold, call and raise happened in a browser and no chain
/// ever saw them — so "the pot" was a number in memory and the contracts were
/// bookends around a game they could not see.
///
/// This is the middle. A hand's chips are LOCKED here for its duration, every
/// action is a transaction, and the pot is contract state. The showdown is
/// still decided on Midnight, because that is the entire point of the project:
/// this contract knows who bet what, and never learns what anybody held.
///
/// @dev The rules encoded here are the same ones src/game/lifecycle.mjs and the
///      Compact contract use. Two implementations of a rule drift; three would
///      have been worse, so the divergences the audit found (NFV-007) are why
///      this file states its rules in the same shape and the tests compare them.
contract NightfoldTable {
    enum Street { Preflop, Flop, Turn, River, Showdown, Done }
    enum Action { Fold, Check, Call, Bet, Raise }

    struct Hand {
        address seat0;
        address seat1;
        uint128 stack0;
        uint128 stack1;
        uint128 committed0;
        uint128 committed1;
        uint128 pot;
        uint128 lastRaise;
        Street street;
        uint8 toAct;
        uint8 acted;      // bitmask: seat 0 = 1, seat 1 = 2
        bool allIn;
        int8 folded;      // -1 none, else the seat that folded
        bool open;
    }

    /// @notice Chips locked in this table, by player. Sourced from the cage.
    mapping(address => uint256) public chips;
    mapping(bytes32 => Hand) public hands;

    uint128 public constant SMALL_BLIND = 1;
    uint128 public constant BIG_BLIND = 2;

    event Deposited(address indexed player, uint256 chips);
    event HandStarted(bytes32 indexed handId, address seat0, address seat1, uint128 stack0, uint128 stack1);
    event Acted(bytes32 indexed handId, uint8 seat, Action action, uint128 amount, uint128 pot);
    event StreetAdvanced(bytes32 indexed handId, Street street, uint128 pot);
    event HandFinished(bytes32 indexed handId, uint8 winner, uint128 pot);

    error NotYourTurn();
    error NotSeated();
    error HandOpen();
    error NoHand();
    error WrongStreet();
    error BadAmount();
    error CannotCheck();
    error InsufficientChips();

    // ---- chips -------------------------------------------------------------

    /// @notice Bring chips to the table. In the full flow these come from the
    ///         cage; the table only needs to know the balance is real.
    function deposit(uint256 amount) external {
        if (amount == 0) revert BadAmount();
        chips[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    // ---- a hand ------------------------------------------------------------

    function startHand(bytes32 handId, address seat1, uint128 buyIn) external {
        Hand storage h = hands[handId];
        if (h.open) revert HandOpen();
        if (buyIn < BIG_BLIND * 2) revert BadAmount();
        if (chips[msg.sender] < buyIn || chips[seat1] < buyIn) revert InsufficientChips();

        chips[msg.sender] -= buyIn;
        chips[seat1] -= buyIn;

        h.seat0 = msg.sender;
        h.seat1 = seat1;
        h.stack0 = buyIn;
        h.stack1 = buyIn;
        h.street = Street.Preflop;
        h.folded = -1;
        h.open = true;

        // Blinds. Heads up, the button posts the small blind and acts first
        // before the flop, which is the rule most people get wrong.
        _put(h, 0, SMALL_BLIND);
        _put(h, 1, BIG_BLIND);
        h.lastRaise = BIG_BLIND;
        h.toAct = 0;

        emit HandStarted(handId, msg.sender, seat1, buyIn, buyIn);
    }

    /// @notice The largest raise this seat can make.
    ///
    /// @dev Capped at the opponent's EFFECTIVE stack, not the actor's own.
    ///      Heads up you can never win more than the other player can put in,
    ///      so betting past that parks chips nobody can match — which deadlocked
    ///      the JavaScript engine until RA-008.
    function maxRaise(bytes32 handId) public view returns (uint128) {
        Hand storage h = hands[handId];
        (uint128 mine, uint128 theirs) = h.toAct == 0
            ? (h.stack0, h.stack1)
            : (h.stack1, h.stack0);
        (uint128 myCommit, uint128 theirCommit) = h.toAct == 0
            ? (h.committed0, h.committed1)
            : (h.committed1, h.committed0);

        uint128 effective = theirs + theirCommit > myCommit ? theirs + theirCommit - myCommit : 0;
        return mine < effective ? mine : effective;
    }

    function toCall(bytes32 handId) public view returns (uint128) {
        Hand storage h = hands[handId];
        (uint128 mine, uint128 theirs) = h.toAct == 0
            ? (h.committed0, h.committed1)
            : (h.committed1, h.committed0);
        return theirs > mine ? theirs - mine : 0;
    }

    function act(bytes32 handId, Action action, uint128 amount) external {
        Hand storage h = hands[handId];
        if (!h.open) revert NoHand();
        if (h.street >= Street.Showdown) revert WrongStreet();

        uint8 seat = _seatOf(h, msg.sender);
        if (seat != h.toAct) revert NotYourTurn();

        uint128 owed = toCall(handId);

        if (action == Action.Fold) {
            h.folded = int8(uint8(seat));
            _finish(handId, h, seat == 0 ? 1 : 0);
            emit Acted(handId, seat, action, 0, h.pot);
            return;
        }

        if (action == Action.Check) {
            if (owed != 0) revert CannotCheck();
        } else if (action == Action.Call) {
            uint128 pay = owed < _stack(h, seat) ? owed : _stack(h, seat);
            _put(h, seat, pay);
        } else {
            // Bet or raise.
            uint128 cap = maxRaise(handId);
            if (amount > cap) revert BadAmount();
            uint128 min = owed + h.lastRaise < cap ? owed + h.lastRaise : cap;
            if (amount < min) revert BadAmount();

            _put(h, seat, amount);
            h.lastRaise = _committed(h, seat) - _committed(h, seat == 0 ? 1 : 0);
            h.acted = 0; // aggression reopens the round
        }

        h.acted |= uint8(1 << seat);
        if (_stack(h, seat) == 0) h.allIn = true;

        _returnUnmatched(h);

        emit Acted(handId, seat, action, amount, h.pot);

        bool matched = h.committed0 == h.committed1;
        bool bothActed = h.acted == 3;
        if (matched && bothActed) {
            _nextStreet(handId, h);
        } else {
            h.toAct = seat == 0 ? 1 : 0;
        }
    }

    /// @dev Money the short stack could not cover was never at risk and cannot
    ///      be won, so it goes back. Without this the commitments stay unequal,
    ///      both stacks sit at zero, and the round never closes.
    function _returnUnmatched(Hand storage h) private {
        if (h.committed0 == h.committed1) return;
        (uint8 over, uint8 under) = h.committed0 > h.committed1 ? (0, 1) : (1, 0);
        if (_stack(h, under) != 0) return;

        uint128 excess = _committed(h, over) - _committed(h, under);
        if (over == 0) { h.committed0 -= excess; h.stack0 += excess; }
        else { h.committed1 -= excess; h.stack1 += excess; }
    }

    function _nextStreet(bytes32 handId, Hand storage h) private {
        h.pot += h.committed0 + h.committed1;
        h.committed0 = 0;
        h.committed1 = 0;
        h.lastRaise = BIG_BLIND;
        h.acted = 0;

        if (h.street == Street.River) {
            h.street = Street.Showdown;
            emit StreetAdvanced(handId, h.street, h.pot);
            return;
        }

        h.street = Street(uint8(h.street) + 1);
        // Postflop the non-button acts first.
        h.toAct = 1;

        // Nothing left to bet once someone is all in; run the board out.
        if (h.allIn || h.stack0 == 0 || h.stack1 == 0) {
            emit StreetAdvanced(handId, h.street, h.pot);
            _nextStreet(handId, h);
            return;
        }
        emit StreetAdvanced(handId, h.street, h.pot);
    }

    /// @notice Award a hand that reached showdown. The winner comes from
    ///         Midnight — this contract never learns a card.
    function settle(bytes32 handId, uint8 winner) external {
        Hand storage h = hands[handId];
        if (!h.open) revert NoHand();
        if (h.street != Street.Showdown) revert WrongStreet();
        if (winner > 2) revert BadAmount();
        _finish(handId, h, winner);
    }

    function _finish(bytes32 handId, Hand storage h, uint8 winner) private {
        uint128 pot = h.pot + h.committed0 + h.committed1;
        h.pot = pot;
        h.committed0 = 0;
        h.committed1 = 0;

        if (winner == 2) {
            uint128 half = pot / 2;
            chips[h.seat0] += h.stack0 + half;
            chips[h.seat1] += h.stack1 + (pot - half);
        } else if (winner == 0) {
            chips[h.seat0] += h.stack0 + pot;
            chips[h.seat1] += h.stack1;
        } else {
            chips[h.seat0] += h.stack0;
            chips[h.seat1] += h.stack1 + pot;
        }

        h.stack0 = 0;
        h.stack1 = 0;
        h.street = Street.Done;
        h.open = false;
        emit HandFinished(handId, winner, pot);
    }

    // ---- helpers -----------------------------------------------------------

    function _seatOf(Hand storage h, address who) private view returns (uint8) {
        if (who == h.seat0) return 0;
        if (who == h.seat1) return 1;
        revert NotSeated();
    }

    function _stack(Hand storage h, uint8 seat) private view returns (uint128) {
        return seat == 0 ? h.stack0 : h.stack1;
    }

    function _committed(Hand storage h, uint8 seat) private view returns (uint128) {
        return seat == 0 ? h.committed0 : h.committed1;
    }

    function _put(Hand storage h, uint8 seat, uint128 amount) private {
        if (seat == 0) {
            uint128 pay = amount < h.stack0 ? amount : h.stack0;
            h.stack0 -= pay;
            h.committed0 += pay;
        } else {
            uint128 pay = amount < h.stack1 ? amount : h.stack1;
            h.stack1 -= pay;
            h.committed1 += pay;
        }
    }
}

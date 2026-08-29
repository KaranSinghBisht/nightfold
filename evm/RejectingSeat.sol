// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice A seat that refuses native-asset transfers.
///
/// The audit (NF-008) used exactly this to wedge an escrow: with push refunds,
/// `timeout` paid both seats in one transaction, so this contract's revert
/// rolled back the honest player's refund too and trapped the stake forever.
/// With pull payments it can only hurt itself.
contract RejectingSeat {
    function call(address target, bytes calldata data) external payable {
        (bool ok, ) = target.call{value: msg.value}(data);
        require(ok, "inner call failed");
    }

    /// Refuses everything.
    receive() external payable {
        revert("no thanks");
    }
}

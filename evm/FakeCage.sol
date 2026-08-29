// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FakeCage
/// @notice Three lines that defeat an interface check, kept as a test fixture.
///
/// @dev NFV-001: NightfoldCage used to call whatever address a relayer named
///     and believe a `true` from `issuedReceipt`. This is the whole exploit —
///     answering an interface is not being the thing. It exists so the
///     regression test can prove the registry, not a signature, is what stops
///     it.
contract FakeCage {
    function issuedReceipt(bytes32) external pure returns (bool) {
        return true;
    }
}

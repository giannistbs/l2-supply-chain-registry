// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DIDAuth
/// @author Ioannis Tampakis
/// @notice Minimal did:ethr authentication module.
/// @dev In did:ethr, the identity controller is an Ethereum address. So `msg.sender`
///      is effectively the DID subject. This module additionally requires maintainers
///      to explicitly opt in by calling `registerMaintainer`, providing a lightweight
///      registry of self-asserted identities that downstream contracts can require.
abstract contract DIDAuth {
    /// @notice Addresses that have self-registered as maintainers.
    mapping(address => bool) public isRegisteredMaintainer;

    event MaintainerRegistered(address indexed maintainer);
    event MaintainerDeregistered(address indexed maintainer);

    error NotRegisteredMaintainer(address caller);
    error AlreadyRegistered(address caller);
    error NotRegistered(address caller);

    modifier onlyRegisteredMaintainer() {
        if (!isRegisteredMaintainer[msg.sender]) {
            revert NotRegisteredMaintainer(msg.sender);
        }
        _;
    }

    /// @notice Self-register the caller as a DID-authenticated maintainer.
    function registerMaintainer() external {
        if (isRegisteredMaintainer[msg.sender]) revert AlreadyRegistered(msg.sender);
        isRegisteredMaintainer[msg.sender] = true;
        emit MaintainerRegistered(msg.sender);
    }

    /// @notice Remove the caller from the maintainer registry.
    function deregisterMaintainer() external {
        if (!isRegisteredMaintainer[msg.sender]) revert NotRegistered(msg.sender);
        isRegisteredMaintainer[msg.sender] = false;
        emit MaintainerDeregistered(msg.sender);
    }
}

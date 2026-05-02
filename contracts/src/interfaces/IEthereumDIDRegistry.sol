// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @author Ioannis Tampakis
/// @notice Minimal subset of the deployed EthereumDIDRegistry interface
///         (0xdCa7EF03e98e0DC2B855bE647C39ABe984fcF21B on mainnet and most networks).
///         See: https://github.com/uport-project/ethr-did-registry
interface IEthereumDIDRegistry {
    /// @notice Returns true if `delegate` is an authorized delegate for `identity`
    ///         under `delegateType`, and the delegation has not expired.
    function validDelegate(address identity, bytes32 delegateType, address delegate)
        external
        view
        returns (bool);
}

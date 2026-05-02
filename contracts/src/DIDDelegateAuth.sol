// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DIDAuth} from "./DIDAuth.sol";
import {IEthereumDIDRegistry} from "./interfaces/IEthereumDIDRegistry.sol";

/// @title DIDDelegateAuth
/// @author Ioannis Tampakis
/// @notice DIDAuth extension that additionally accepts did:ethr delegates for a
///         maintainer's identity address. A caller is considered authorized if
///         either:
///           (a) they are the identity itself (msg.sender == identity), or
///           (b) they are a `sigAuth` delegate of the identity per the
///               deployed EthereumDIDRegistry.
///
///         This lets a maintainer authorize a secondary signing key (for CI,
///         hardware wallet, etc.) without transferring package ownership.
abstract contract DIDDelegateAuth is DIDAuth {
    IEthereumDIDRegistry public immutable didRegistry;

    /// @notice keccak256("sigAuth") — the standard did:ethr authentication delegate type.
    bytes32 public constant SIG_AUTH = keccak256("sigAuth");

    constructor(address didRegistry_) {
        didRegistry = IEthereumDIDRegistry(didRegistry_);
    }

    /// @notice Check whether `caller` is authorized to act on behalf of `identity`.
    function isAuthorizedFor(address identity, address caller) public view returns (bool) {
        if (identity == caller) return true;
        if (address(didRegistry) == address(0)) return false;
        return didRegistry.validDelegate(identity, SIG_AUTH, caller);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPackageRegistry} from "./interfaces/IPackageRegistry.sol";
import {DIDAuth} from "./DIDAuth.sol";

/// @title PackageRegistry
/// @author Ioannis Tampakis
/// @notice Storage-agnostic package integrity registry. Maps (name, version) to a
///         content hash together with the publishing maintainer's address and a
///         timestamp. Hashes are computed off-chain by the client (SHA-256) and
///         submitted as bytes32.
/// @dev Maintainer authentication is enforced via the DIDAuth module: publishers
///      must have self-registered as did:ethr maintainers. Package-level ownership
///      is enforced by comparing `msg.sender` against the stored owner address.
contract PackageRegistry is IPackageRegistry, DIDAuth {
    struct Version {
        bytes32 contentHash;
        uint256 timestamp;
        bool revoked;
    }

    struct Package {
        address owner;
        bool exists;
        mapping(string => Version) versions;
        string[] versionList;
    }

    mapping(string => Package) internal _packages;

    error PackageAlreadyExists(string name);
    error PackageDoesNotExist(string name);
    error NotPackageOwner(string name, address caller);
    error VersionAlreadyExists(string name, string version);
    error VersionDoesNotExist(string name, string version);
    error VersionAlreadyRevoked(string name, string version);
    error ZeroAddressOwner();
    error EmptyString();

    modifier onlyOwnerOf(string calldata name) {
        Package storage pkg = _packages[name];
        if (!pkg.exists) revert PackageDoesNotExist(name);
        if (pkg.owner != msg.sender) revert NotPackageOwner(name, msg.sender);
        _;
    }

    /// @inheritdoc IPackageRegistry
    function registerPackage(string calldata name) external override onlyRegisteredMaintainer {
        if (bytes(name).length == 0) revert EmptyString();
        Package storage pkg = _packages[name];
        if (pkg.exists) revert PackageAlreadyExists(name);
        pkg.exists = true;
        pkg.owner = msg.sender;
        emit PackageRegistered(name, msg.sender);
    }

    /// @inheritdoc IPackageRegistry
    function publishVersion(string calldata name, string calldata version, bytes32 contentHash)
        external
        override
        onlyRegisteredMaintainer
        onlyOwnerOf(name)
    {
        if (bytes(version).length == 0) revert EmptyString();
        Package storage pkg = _packages[name];
        Version storage ver = pkg.versions[version];
        if (ver.timestamp != 0) revert VersionAlreadyExists(name, version);
        ver.contentHash = contentHash;
        ver.timestamp = block.timestamp;
        ver.revoked = false;
        pkg.versionList.push(version);
        emit VersionPublished(name, version, contentHash, msg.sender, block.timestamp);
    }

    /// @inheritdoc IPackageRegistry
    function verifyVersion(string calldata name, string calldata version)
        external
        view
        override
        returns (bytes32 contentHash, address owner, uint256 timestamp, bool revoked)
    {
        Package storage pkg = _packages[name];
        if (!pkg.exists) revert PackageDoesNotExist(name);
        Version storage ver = pkg.versions[version];
        if (ver.timestamp == 0) revert VersionDoesNotExist(name, version);
        return (ver.contentHash, pkg.owner, ver.timestamp, ver.revoked);
    }

    /// @inheritdoc IPackageRegistry
    function transferOwnership(string calldata name, address newOwner) external override onlyOwnerOf(name) {
        if (newOwner == address(0)) revert ZeroAddressOwner();
        Package storage pkg = _packages[name];
        address oldOwner = pkg.owner;
        pkg.owner = newOwner;
        emit OwnershipTransferred(name, oldOwner, newOwner);
    }

    /// @inheritdoc IPackageRegistry
    function revokeVersion(string calldata name, string calldata version) external override onlyOwnerOf(name) {
        Package storage pkg = _packages[name];
        Version storage ver = pkg.versions[version];
        if (ver.timestamp == 0) revert VersionDoesNotExist(name, version);
        if (ver.revoked) revert VersionAlreadyRevoked(name, version);
        ver.revoked = true;
        emit VersionRevoked(name, version);
    }

    /// @notice Returns basic package info.
    function getPackage(string calldata name) external view returns (address owner, bool exists, uint256 versionCount) {
        Package storage pkg = _packages[name];
        return (pkg.owner, pkg.exists, pkg.versionList.length);
    }

    /// @notice Returns the list of published version strings (including revoked ones).
    function listVersions(string calldata name) external view returns (string[] memory) {
        Package storage pkg = _packages[name];
        if (!pkg.exists) revert PackageDoesNotExist(name);
        return pkg.versionList;
    }
}

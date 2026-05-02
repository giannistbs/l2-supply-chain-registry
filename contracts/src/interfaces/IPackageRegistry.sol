// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPackageRegistry
/// @author Ioannis Tampakis
/// @notice External interface for the package integrity registry.
interface IPackageRegistry {
    event PackageRegistered(string name, address indexed owner);
    event VersionPublished(
        string name, string version, bytes32 contentHash, address indexed publisher, uint256 timestamp
    );
    event OwnershipTransferred(string name, address indexed oldOwner, address indexed newOwner);
    event VersionRevoked(string name, string version);

    function registerPackage(string calldata name) external;

    function publishVersion(string calldata name, string calldata version, bytes32 contentHash) external;

    function verifyVersion(string calldata name, string calldata version)
        external
        view
        returns (bytes32 contentHash, address owner, uint256 timestamp, bool revoked);

    function transferOwnership(string calldata name, address newOwner) external;

    function revokeVersion(string calldata name, string calldata version) external;
}

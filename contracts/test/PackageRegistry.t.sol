// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PackageRegistry} from "../src/PackageRegistry.sol";
import {DIDAuth} from "../src/DIDAuth.sol";
import {IPackageRegistry} from "../src/interfaces/IPackageRegistry.sol";

contract PackageRegistryTest is Test {
    PackageRegistry internal registry;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    string internal constant NAME = "test-package";
    string internal constant V1 = "1.0.0";
    string internal constant V2 = "1.0.1";
    bytes32 internal constant HASH1 = keccak256("artifact-v1");
    bytes32 internal constant HASH2 = keccak256("artifact-v2");

    function setUp() public {
        registry = new PackageRegistry();
        vm.prank(alice);
        registry.registerMaintainer();
        vm.prank(bob);
        registry.registerMaintainer();
    }

    // --- registerPackage ---

    function test_registerPackage_happy() public {
        vm.expectEmit(true, true, true, true);
        emit IPackageRegistry.PackageRegistered(NAME, alice);
        vm.prank(alice);
        registry.registerPackage(NAME);

        (address owner, bool exists, uint256 count) = registry.getPackage(NAME);
        assertEq(owner, alice);
        assertTrue(exists);
        assertEq(count, 0);
    }

    function test_registerPackage_duplicate_reverts() public {
        vm.prank(alice);
        registry.registerPackage(NAME);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PackageRegistry.PackageAlreadyExists.selector, NAME));
        registry.registerPackage(NAME);
    }

    function test_registerPackage_empty_reverts() public {
        vm.prank(alice);
        vm.expectRevert(PackageRegistry.EmptyString.selector);
        registry.registerPackage("");
    }

    function test_registerPackage_unregisteredMaintainer_reverts() public {
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(DIDAuth.NotRegisteredMaintainer.selector, carol));
        registry.registerPackage(NAME);
    }

    // --- publishVersion ---

    function test_publishVersion_happy() public {
        vm.prank(alice);
        registry.registerPackage(NAME);

        vm.expectEmit(true, true, true, true);
        emit IPackageRegistry.VersionPublished(NAME, V1, HASH1, alice, block.timestamp);
        vm.prank(alice);
        registry.publishVersion(NAME, V1, HASH1);

        (bytes32 h, address owner, uint256 ts, bool revoked) = registry.verifyVersion(NAME, V1);
        assertEq(h, HASH1);
        assertEq(owner, alice);
        assertEq(ts, block.timestamp);
        assertFalse(revoked);
    }

    function test_publishVersion_notOwner_reverts() public {
        vm.prank(alice);
        registry.registerPackage(NAME);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PackageRegistry.NotPackageOwner.selector, NAME, bob));
        registry.publishVersion(NAME, V1, HASH1);
    }

    function test_publishVersion_noPackage_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PackageRegistry.PackageDoesNotExist.selector, NAME));
        registry.publishVersion(NAME, V1, HASH1);
    }

    function test_publishVersion_duplicate_reverts() public {
        vm.prank(alice);
        registry.registerPackage(NAME);
        vm.prank(alice);
        registry.publishVersion(NAME, V1, HASH1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PackageRegistry.VersionAlreadyExists.selector, NAME, V1));
        registry.publishVersion(NAME, V1, HASH2);
    }

    function test_publishVersion_emptyVersion_reverts() public {
        vm.prank(alice);
        registry.registerPackage(NAME);
        vm.prank(alice);
        vm.expectRevert(PackageRegistry.EmptyString.selector);
        registry.publishVersion(NAME, "", HASH1);
    }

    function test_listVersions_ordered() public {
        vm.startPrank(alice);
        registry.registerPackage(NAME);
        registry.publishVersion(NAME, V1, HASH1);
        registry.publishVersion(NAME, V2, HASH2);
        vm.stopPrank();

        string[] memory versions = registry.listVersions(NAME);
        assertEq(versions.length, 2);
        assertEq(versions[0], V1);
        assertEq(versions[1], V2);
    }

    // --- verifyVersion ---

    function test_verifyVersion_missing_reverts() public {
        vm.prank(alice);
        registry.registerPackage(NAME);
        vm.expectRevert(abi.encodeWithSelector(PackageRegistry.VersionDoesNotExist.selector, NAME, V1));
        registry.verifyVersion(NAME, V1);
    }

    // --- transferOwnership ---

    function test_transferOwnership_happy() public {
        vm.prank(alice);
        registry.registerPackage(NAME);

        vm.expectEmit(true, true, true, true);
        emit IPackageRegistry.OwnershipTransferred(NAME, alice, bob);
        vm.prank(alice);
        registry.transferOwnership(NAME, bob);

        (address owner,,) = registry.getPackage(NAME);
        assertEq(owner, bob);
    }

    function test_transferOwnership_newOwnerCanPublish_oldCannot() public {
        vm.prank(alice);
        registry.registerPackage(NAME);
        vm.prank(alice);
        registry.transferOwnership(NAME, bob);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PackageRegistry.NotPackageOwner.selector, NAME, alice));
        registry.publishVersion(NAME, V1, HASH1);

        vm.prank(bob);
        registry.publishVersion(NAME, V1, HASH1);
    }

    function test_transferOwnership_notOwner_reverts() public {
        vm.prank(alice);
        registry.registerPackage(NAME);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PackageRegistry.NotPackageOwner.selector, NAME, bob));
        registry.transferOwnership(NAME, bob);
    }

    function test_transferOwnership_zeroAddress_reverts() public {
        vm.prank(alice);
        registry.registerPackage(NAME);
        vm.prank(alice);
        vm.expectRevert(PackageRegistry.ZeroAddressOwner.selector);
        registry.transferOwnership(NAME, address(0));
    }

    // --- revokeVersion ---

    function test_revokeVersion_happy() public {
        vm.startPrank(alice);
        registry.registerPackage(NAME);
        registry.publishVersion(NAME, V1, HASH1);
        vm.expectEmit(true, true, true, true);
        emit IPackageRegistry.VersionRevoked(NAME, V1);
        registry.revokeVersion(NAME, V1);
        vm.stopPrank();

        (,,, bool revoked) = registry.verifyVersion(NAME, V1);
        assertTrue(revoked);
    }

    function test_revokeVersion_alreadyRevoked_reverts() public {
        vm.startPrank(alice);
        registry.registerPackage(NAME);
        registry.publishVersion(NAME, V1, HASH1);
        registry.revokeVersion(NAME, V1);
        vm.expectRevert(abi.encodeWithSelector(PackageRegistry.VersionAlreadyRevoked.selector, NAME, V1));
        registry.revokeVersion(NAME, V1);
        vm.stopPrank();
    }

    function test_revokeVersion_notOwner_reverts() public {
        vm.prank(alice);
        registry.registerPackage(NAME);
        vm.prank(alice);
        registry.publishVersion(NAME, V1, HASH1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PackageRegistry.NotPackageOwner.selector, NAME, bob));
        registry.revokeVersion(NAME, V1);
    }

    function test_revokeVersion_missing_reverts() public {
        vm.prank(alice);
        registry.registerPackage(NAME);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PackageRegistry.VersionDoesNotExist.selector, NAME, V1));
        registry.revokeVersion(NAME, V1);
    }
}

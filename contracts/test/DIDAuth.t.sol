// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DIDAuth} from "../src/DIDAuth.sol";

contract DIDAuthHarness is DIDAuth {
    function guarded() external onlyRegisteredMaintainer returns (bool) {
        return true;
    }
}

contract DIDAuthTest is Test {
    DIDAuthHarness internal auth;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        auth = new DIDAuthHarness();
    }

    function test_registerMaintainer() public {
        vm.prank(alice);
        auth.registerMaintainer();
        assertTrue(auth.isRegisteredMaintainer(alice));
    }

    function test_registerMaintainer_duplicate_reverts() public {
        vm.prank(alice);
        auth.registerMaintainer();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DIDAuth.AlreadyRegistered.selector, alice));
        auth.registerMaintainer();
    }

    function test_deregisterMaintainer() public {
        vm.prank(alice);
        auth.registerMaintainer();
        vm.prank(alice);
        auth.deregisterMaintainer();
        assertFalse(auth.isRegisteredMaintainer(alice));
    }

    function test_deregister_notRegistered_reverts() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(DIDAuth.NotRegistered.selector, bob));
        auth.deregisterMaintainer();
    }

    function test_onlyRegisteredMaintainer_modifier() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(DIDAuth.NotRegisteredMaintainer.selector, bob));
        auth.guarded();

        vm.prank(bob);
        auth.registerMaintainer();
        vm.prank(bob);
        assertTrue(auth.guarded());
    }
}

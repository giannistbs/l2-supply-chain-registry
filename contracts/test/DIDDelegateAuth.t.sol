// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DIDDelegateAuth} from "../src/DIDDelegateAuth.sol";
import {IEthereumDIDRegistry} from "../src/interfaces/IEthereumDIDRegistry.sol";

contract MockDIDRegistry is IEthereumDIDRegistry {
    mapping(address => mapping(bytes32 => mapping(address => bool))) public delegates;

    function setDelegate(address identity, bytes32 delegateType, address delegate, bool ok) external {
        delegates[identity][delegateType][delegate] = ok;
    }

    function validDelegate(address identity, bytes32 delegateType, address delegate)
        external
        view
        override
        returns (bool)
    {
        return delegates[identity][delegateType][delegate];
    }
}

contract DelegateHarness is DIDDelegateAuth {
    constructor(address r) DIDDelegateAuth(r) {}
}

contract DIDDelegateAuthTest is Test {
    MockDIDRegistry internal reg;
    DelegateHarness internal auth;

    address internal alice = makeAddr("alice");
    address internal aliceCiKey = makeAddr("aliceCiKey");
    address internal mallory = makeAddr("mallory");

    function setUp() public {
        reg = new MockDIDRegistry();
        auth = new DelegateHarness(address(reg));
    }

    function test_identityIsAuthorizedForSelf() public view {
        assertTrue(auth.isAuthorizedFor(alice, alice));
    }

    function test_delegate_rejectedWhenNotRegistered() public view {
        assertFalse(auth.isAuthorizedFor(alice, aliceCiKey));
    }

    function test_delegate_acceptedWhenRegistered() public {
        reg.setDelegate(alice, auth.SIG_AUTH(), aliceCiKey, true);
        assertTrue(auth.isAuthorizedFor(alice, aliceCiKey));
    }

    function test_unrelatedAddressNeverAuthorized() public {
        reg.setDelegate(alice, auth.SIG_AUTH(), aliceCiKey, true);
        assertFalse(auth.isAuthorizedFor(alice, mallory));
    }

    function test_worksWithZeroRegistryAddress() public {
        DelegateHarness nullAuth = new DelegateHarness(address(0));
        assertTrue(nullAuth.isAuthorizedFor(alice, alice));
        assertFalse(nullAuth.isAuthorizedFor(alice, aliceCiKey));
    }
}

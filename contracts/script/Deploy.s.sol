// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PackageRegistry} from "../src/PackageRegistry.sol";

/// @notice Deploys the PackageRegistry to the configured network.
///         Reads PRIVATE_KEY from env (falls back to Anvil default key 0 for local use).
contract Deploy is Script {
    function run() external returns (PackageRegistry registry) {
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        vm.startBroadcast(pk);
        registry = new PackageRegistry();
        vm.stopBroadcast();
        console2.log("PackageRegistry deployed at:", address(registry));
        console2.log("Chain ID:", block.chainid);
    }
}

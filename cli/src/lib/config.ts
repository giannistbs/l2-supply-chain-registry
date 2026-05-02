import "dotenv/config";
import type { NetworkConfig, RuntimeConfig } from "../types/index.js";

const NETWORKS: Record<string, Omit<NetworkConfig, "contractAddress"> & { envAddr: string }> = {
  anvil: {
    name: "anvil",
    rpcUrl: process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545",
    chainId: 31337,
    envAddr: "ANVIL_REGISTRY_ADDRESS",
  },
  "scroll-sepolia": {
    name: "scroll-sepolia",
    rpcUrl: process.env.SCROLL_SEPOLIA_RPC_URL ?? "https://sepolia-rpc.scroll.io",
    chainId: 534351,
    envAddr: "SCROLL_SEPOLIA_REGISTRY_ADDRESS",
  },
  "base-sepolia": {
    name: "base-sepolia",
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
    chainId: 84532,
    envAddr: "BASE_SEPOLIA_REGISTRY_ADDRESS",
  },
  "arbitrum-sepolia": {
    name: "arbitrum-sepolia",
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc",
    chainId: 421614,
    envAddr: "ARBITRUM_SEPOLIA_REGISTRY_ADDRESS",
  },
};

export function listNetworks(): string[] {
  return Object.keys(NETWORKS);
}

export function loadConfig(networkName: string): RuntimeConfig {
  const spec = NETWORKS[networkName];
  if (!spec) {
    throw new Error(`Unknown network: ${networkName}. Available: ${listNetworks().join(", ")}`);
  }
  const contractAddress = process.env[spec.envAddr];
  if (!contractAddress) {
    throw new Error(
      `Missing contract address. Set ${spec.envAddr} in env (or pass --contract).`,
    );
  }
  const privateKey = process.env.REGISTRY_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("Missing REGISTRY_PRIVATE_KEY env var.");
  }
  return {
    network: {
      name: spec.name,
      rpcUrl: spec.rpcUrl,
      chainId: spec.chainId,
      contractAddress,
    },
    privateKey,
  };
}

export function loadConfigWithOverrides(
  networkName: string,
  overrides: { contract?: string; rpcUrl?: string },
): RuntimeConfig {
  const spec = NETWORKS[networkName];
  if (!spec) {
    throw new Error(`Unknown network: ${networkName}. Available: ${listNetworks().join(", ")}`);
  }
  const contractAddress = overrides.contract ?? process.env[spec.envAddr];
  if (!contractAddress) {
    throw new Error(
      `Missing contract address. Set ${spec.envAddr} in env or pass --contract.`,
    );
  }
  const privateKey = process.env.REGISTRY_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("Missing REGISTRY_PRIVATE_KEY env var.");
  }
  return {
    network: {
      name: spec.name,
      rpcUrl: overrides.rpcUrl ?? spec.rpcUrl,
      chainId: spec.chainId,
      contractAddress,
    },
    privateKey,
  };
}

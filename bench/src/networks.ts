import "dotenv/config";

export interface AnvilNetwork {
  name: string;
  rpcUrl: string;
  chainId: number;
  contractAddress: string;
}

export type L2MainnetName = "base" | "scroll" | "arbitrum";

export interface L2PricingNetwork {
  name: L2MainnetName;
  rpcUrl: string;
  chainId: number;
  feeModel: "op-stack" | "scroll" | "arbitrum-nitro";
}

interface LegacySpec {
  name: string;
  rpcEnv: string;
  rpcDefault: string;
  chainId: number;
  addrEnv: string;
}

const ANVIL_CHAIN_ID = 31337;

const L2_PRICING_NETWORKS: L2PricingNetwork[] = [
  {
    name: "base",
    rpcUrl: process.env.BASE_MAINNET_RPC_URL ?? "wss://base-rpc.publicnode.com",
    chainId: 8453,
    feeModel: "op-stack",
  },
  {
    name: "scroll",
    rpcUrl: process.env.SCROLL_MAINNET_RPC_URL ?? "https://scroll.api.pocket.network",
    chainId: 534352,
    feeModel: "scroll",
  },
  {
    name: "arbitrum",
    rpcUrl: process.env.ARBITRUM_MAINNET_RPC_URL ?? "https://arb1.arbitrum.io/rpc",
    chainId: 42161,
    feeModel: "arbitrum-nitro",
  },
];

const LEGACY_TESTNET_SPECS: LegacySpec[] = [
  {
    name: "scroll-sepolia",
    rpcEnv: "SCROLL_SEPOLIA_RPC_URL",
    rpcDefault: "https://sepolia-rpc.scroll.io",
    chainId: 534351,
    addrEnv: "SCROLL_SEPOLIA_REGISTRY_ADDRESS",
  },
  {
    name: "base-sepolia",
    rpcEnv: "BASE_SEPOLIA_RPC_URL",
    rpcDefault: "https://sepolia.base.org",
    chainId: 84532,
    addrEnv: "BASE_SEPOLIA_REGISTRY_ADDRESS",
  },
  {
    name: "arbitrum-sepolia",
    rpcEnv: "ARBITRUM_SEPOLIA_RPC_URL",
    rpcDefault: "https://sepolia-rollup.arbitrum.io/rpc",
    chainId: 421614,
    addrEnv: "ARBITRUM_SEPOLIA_REGISTRY_ADDRESS",
  },
];

export function getAnvilNetwork(): AnvilNetwork {
  const addr = process.env.ANVIL_REGISTRY_ADDRESS;
  if (!addr) throw new Error("Missing ANVIL_REGISTRY_ADDRESS");
  return {
    name: "anvil",
    rpcUrl: process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545",
    chainId: ANVIL_CHAIN_ID,
    contractAddress: addr,
  };
}

export function getPricingNetworks(): L2PricingNetwork[] {
  return L2_PRICING_NETWORKS;
}

export function getLegacyTestnetNetworks(): AnvilNetwork[] {
  const out: AnvilNetwork[] = [];
  for (const s of LEGACY_TESTNET_SPECS) {
    const addr = process.env[s.addrEnv];
    if (!addr) continue;
    out.push({
      name: s.name,
      rpcUrl: process.env[s.rpcEnv] ?? s.rpcDefault,
      chainId: s.chainId,
      contractAddress: addr,
    });
  }
  return out;
}

export function getPrivateKey(): string {
  const pk = process.env.REGISTRY_PRIVATE_KEY;
  if (!pk) throw new Error("Missing REGISTRY_PRIVATE_KEY");
  return pk;
}

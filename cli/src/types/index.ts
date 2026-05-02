export interface NetworkConfig {
  name: string;
  rpcUrl: string;
  chainId: number;
  contractAddress: string;
}

export interface RuntimeConfig {
  network: NetworkConfig;
  privateKey: string;
}

export interface TxReceiptSummary {
  txHash: string;
  blockNumber: number;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  wallClockMs: number;
}

export interface VerifyResult {
  match: boolean;
  localHash: string;
  onChainHash: string;
  owner: string;
  timestamp: number;
  revoked: boolean;
  rpcLatencyMs: number;
}

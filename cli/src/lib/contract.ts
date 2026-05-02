import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Contract, JsonRpcProvider, Wallet, type InterfaceAbi } from "ethers";
import type { RuntimeConfig, TxReceiptSummary } from "../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadAbi(): InterfaceAbi {
  const candidates = [
    resolve(__dirname, "../../abi/PackageRegistry.json"),
    resolve(__dirname, "../../../abi/PackageRegistry.json"),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      continue;
    }
  }
  throw new Error(`Could not locate PackageRegistry ABI. Looked in: ${candidates.join(", ")}`);
}

export const REGISTRY_ABI = loadAbi();

export interface Handles {
  provider: JsonRpcProvider;
  wallet: Wallet;
  contract: Contract;
  config: RuntimeConfig;
}

export function connect(config: RuntimeConfig): Handles {
  const provider = new JsonRpcProvider(config.network.rpcUrl, config.network.chainId);
  const wallet = new Wallet(config.privateKey, provider);
  const contract = new Contract(config.network.contractAddress, REGISTRY_ABI, wallet);
  return { provider, wallet, contract, config };
}

export async function sendTx(
  tx: Promise<{ hash: string; wait: () => Promise<unknown> }>,
): Promise<TxReceiptSummary> {
  const start = performance.now();
  const response = await tx;
  const receipt = (await response.wait()) as {
    blockNumber: number;
    gasUsed: bigint;
    gasPrice?: bigint;
    effectiveGasPrice?: bigint;
    hash: string;
  };
  const wallClockMs = performance.now() - start;
  return {
    txHash: receipt.hash ?? response.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    effectiveGasPrice: receipt.effectiveGasPrice ?? receipt.gasPrice ?? 0n,
    wallClockMs,
  };
}

export function formatReceipt(r: TxReceiptSummary): string {
  const priceGwei = Number(r.effectiveGasPrice) / 1e9;
  return [
    `  tx:           ${r.txHash}`,
    `  block:        ${r.blockNumber}`,
    `  gas used:     ${r.gasUsed.toString()}`,
    `  gas price:    ${priceGwei.toFixed(6)} gwei`,
    `  confirm time: ${r.wallClockMs.toFixed(1)} ms`,
  ].join("\n");
}

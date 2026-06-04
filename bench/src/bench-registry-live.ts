/**
 * Live Base mainnet registry benchmark.
 *
 * Unlike bench-registry.ts (Anvil gas + mainnet fee-oracle model), this harness
 * deploys the PackageRegistry to Base mainnet and runs every operation as a real
 * transaction, recording observed gasUsed, effective L2 gas price, the OP-stack
 * L1 data fee (l1Fee, taken directly from the transaction receipt), total fee,
 * and confirmation latency. Verification read latency is measured with sequential
 * eth_call requests.
 *
 * Real funds are spent. The run is gated behind a pre-flight check and an explicit
 * --confirm flag; without --confirm it prints a cost estimate and sends nothing.
 *
 * Usage:
 *   tsx bench-registry-live.ts [--publish-samples 25] [--read-samples 25]
 *                              [--max-gas-price-gwei 0.1] [--confirm]
 */
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import {
  Contract,
  ContractFactory,
  formatEther,
  parseUnits,
  Wallet,
  type ContractTransactionResponse,
  type InterfaceAbi,
} from "ethers";
import { createProvider, type RpcProvider } from "./l1-fee-model.js";
import { getPrivateKey } from "./networks.js";
import { fetchEthUsdPrice, nowIso, statsOf, writeJson } from "./util.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The wallet env lives at the project root, not in bench/, so load it explicitly.
loadEnv({ path: resolve(__dirname, "../../.env") });

const BASE_CHAIN_ID = 8453;
const ARTIFACT_PATH = resolve(__dirname, "../../contracts/out/PackageRegistry.sol/PackageRegistry.json");
const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf-8")) as {
  abi: InterfaceAbi;
  bytecode: { object: string };
};
const ABI = artifact.abi;
const BYTECODE = artifact.bytecode.object;

// Deterministic gas from the Anvil measurement, used only for the pre-flight spend estimate.
const KNOWN_GAS = {
  deploy: 911_979n,
  registerPackage: 46_698n,
  publishVersion: 121_013n,
  revokeVersion: 52_887n,
  transferOwnership: 31_021n,
} as const;

interface TxRun {
  op: string;
  sample: number;
  network: "base";
  chainId: number;
  gasUsed: string;
  txConfirmMs: number;
  l2GasPriceWei: string;
  l2ExecutionFeeWei: string;
  l1DataFeeWei: string;
  totalFeeWei: string;
  ethUsdPrice: number;
  l2ExecutionUsd: number;
  l1DataUsd: number;
  totalUsd: number;
  serializedTxBytes: number;
  blockNumber: number;
  txHash: string;
  timestamp: string;
}

interface ReadRun {
  op: string;
  network: "base";
  rpcLatencyMs: number;
  timestamp: string;
}

interface RawReceipt {
  gasUsed: string;
  effectiveGasPrice: string;
  l1Fee?: string;
  blockNumber: string;
}

function argNum(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  return Number(process.argv[i + 1] ?? fallback);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function randomHash(): string {
  return "0x" + createHash("sha256").update(randomBytes(32)).digest("hex");
}

function randomName(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}-${Date.now()}`;
}

function weiToUsd(wei: bigint, ethUsdPrice: number): number {
  return (Number(wei) * ethUsdPrice) / 1e18;
}

function dataBytes(data: string | null | undefined): number {
  if (!data || data === "0x") return 0;
  return (data.length - 2) / 2;
}

async function main() {
  const publishSamples = Math.max(1, Math.floor(argNum("--publish-samples", 25)));
  const readSamples = Math.max(1, Math.floor(argNum("--read-samples", 25)));
  const maxGasPriceGwei = argNum("--max-gas-price-gwei", 0.1);
  const confirm = hasFlag("--confirm");

  const rpcUrl = process.env.BASE_MAINNET_RPC_URL ?? "https://mainnet.base.org";
  const provider: RpcProvider = createProvider({ rpcUrl, chainId: BASE_CHAIN_ID });

  // Pre-flight: chain identity, gas price ceiling, and balance sufficiency.
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== BASE_CHAIN_ID) {
    throw new Error(`Expected Base mainnet (chainId ${BASE_CHAIN_ID}), RPC reports ${net.chainId}`);
  }

  const wallet = new Wallet(getPrivateKey(), provider);
  const address = await wallet.getAddress();
  const balanceWei = await provider.getBalance(address);
  const gasPriceWei = BigInt(await provider.send("eth_gasPrice", []));
  const maxGasPriceWei = parseUnits(maxGasPriceGwei.toString(), "gwei");

  const estGas =
    KNOWN_GAS.deploy +
    KNOWN_GAS.registerPackage * 2n +
    KNOWN_GAS.publishVersion * BigInt(publishSamples) +
    KNOWN_GAS.revokeVersion +
    KNOWN_GAS.transferOwnership;
  const estCostWei = estGas * gasPriceWei;
  const ethUsdPrice = await fetchEthUsdPrice();

  console.log(`[bench-registry-live] Base mainnet, wallet ${address}`);
  console.log(`  balance:        ${formatEther(balanceWei)} ETH ($${(Number(formatEther(balanceWei)) * ethUsdPrice).toFixed(2)})`);
  console.log(`  gas price:      ${Number(gasPriceWei) / 1e9} gwei (ceiling ${maxGasPriceGwei} gwei)`);
  console.log(`  ETH/USD:        ${ethUsdPrice}`);
  console.log(`  plan:           deploy + 2 register + ${publishSamples} publish + ${readSamples} reads + 1 revoke + 1 transfer`);
  console.log(`  est. L2 spend:  ${formatEther(estCostWei)} ETH ($${(Number(formatEther(estCostWei)) * ethUsdPrice).toFixed(4)}) [excludes small L1 data fee]`);

  if (gasPriceWei > maxGasPriceWei) {
    throw new Error(
      `Aborting: Base gas price ${Number(gasPriceWei) / 1e9} gwei exceeds ceiling ${maxGasPriceGwei} gwei. ` +
        `Wait for calmer gas or raise --max-gas-price-gwei.`,
    );
  }
  // Require a 2x margin over the L2 estimate to cover L1 data fees and price movement.
  if (balanceWei < estCostWei * 2n) {
    throw new Error(
      `Aborting: balance ${formatEther(balanceWei)} ETH is below the 2x safety margin ` +
        `(${formatEther(estCostWei * 2n)} ETH). Fund the wallet or lower --publish-samples.`,
    );
  }

  if (!confirm) {
    console.log("\nDRY RUN: pre-flight checks passed. Re-run with --confirm to send real transactions.");
    return;
  }

  console.log("\n--confirm set: sending real transactions to Base mainnet...\n");

  const startedAt = nowIso();
  const txRuns: TxRun[] = [];
  const reads: ReadRun[] = [];

  async function fetchRaw(hash: string): Promise<RawReceipt> {
    return (await provider.send("eth_getTransactionReceipt", [hash])) as RawReceipt;
  }

  function record(op: string, sample: number, raw: RawReceipt, txHash: string, ms: number, bytes: number): void {
    const gasUsed = BigInt(raw.gasUsed);
    const effGasPrice = BigInt(raw.effectiveGasPrice);
    const l1Fee = BigInt(raw.l1Fee ?? "0x0");
    const l2ExecWei = gasUsed * effGasPrice;
    const totalWei = l2ExecWei + l1Fee;
    txRuns.push({
      op,
      sample,
      network: "base",
      chainId: BASE_CHAIN_ID,
      gasUsed: gasUsed.toString(),
      txConfirmMs: ms,
      l2GasPriceWei: effGasPrice.toString(),
      l2ExecutionFeeWei: l2ExecWei.toString(),
      l1DataFeeWei: l1Fee.toString(),
      totalFeeWei: totalWei.toString(),
      ethUsdPrice,
      l2ExecutionUsd: weiToUsd(l2ExecWei, ethUsdPrice),
      l1DataUsd: weiToUsd(l1Fee, ethUsdPrice),
      totalUsd: weiToUsd(totalWei, ethUsdPrice),
      serializedTxBytes: bytes,
      blockNumber: parseInt(raw.blockNumber, 16),
      txHash,
      timestamp: nowIso(),
    });
  }

  async function measureTx(
    op: string,
    sample: number,
    send: () => Promise<ContractTransactionResponse>,
  ): Promise<void> {
    const t0 = performance.now();
    const tx = await send();
    await tx.wait();
    const ms = performance.now() - t0;
    const raw = await fetchRaw(tx.hash);
    record(op, sample, raw, tx.hash, ms, dataBytes(tx.data));
    console.log(`  ${op} #${sample}: gas ${raw.gasUsed && BigInt(raw.gasUsed)} confirm ${ms.toFixed(0)}ms tx ${tx.hash}`);
    await new Promise((r) => setTimeout(r, 100));
  }

  // 1) Deploy the contract live and capture its receipt.
  const factory = new ContractFactory(ABI, BYTECODE, wallet);
  const tDeploy = performance.now();
  const deployed = await factory.deploy();
  const deployTx = deployed.deploymentTransaction();
  if (!deployTx) throw new Error("no deployment transaction");
  await deployed.waitForDeployment();
  const deployMs = performance.now() - tDeploy;
  const contractAddress = await deployed.getAddress();
  const deployRaw = await fetchRaw(deployTx.hash);
  record("deploy", 1, deployRaw, deployTx.hash, deployMs, dataBytes(deployTx.data));
  console.log(`  deploy: address ${contractAddress} gas ${deployRaw.gasUsed && BigInt(deployRaw.gasUsed)} confirm ${deployMs.toFixed(0)}ms tx ${deployTx.hash}`);
  await new Promise((r) => setTimeout(r, 100));

  const registry = new Contract(contractAddress, ABI, wallet) as unknown as {
    registerPackage: (n: string) => Promise<ContractTransactionResponse>;
    publishVersion: (n: string, v: string, h: string) => Promise<ContractTransactionResponse>;
    verifyVersion: (n: string, v: string) => Promise<[string, string, bigint, boolean]>;
    transferOwnership: (n: string, a: string) => Promise<ContractTransactionResponse>;
    revokeVersion: (n: string, v: string) => Promise<ContractTransactionResponse>;
  };

  // 2) Register package A.
  const nameA = randomName("bench");
  await measureTx("registerPackage", 1, () => registry.registerPackage(nameA));

  // 3) Publish N distinct versions (latency hot path).
  const versions: string[] = [];
  for (let k = 1; k <= publishSamples; k++) {
    const version = `1.0.${k}`;
    versions.push(version);
    const hash = randomHash();
    await measureTx("publishVersion", k, () => registry.publishVersion(nameA, version, hash));
  }

  // 4) Verification read latency: sequential eth_call over the published versions.
  for (let k = 0; k < readSamples; k++) {
    const version = versions[k % versions.length]!;
    const t0 = performance.now();
    await registry.verifyVersion(nameA, version);
    const ms = performance.now() - t0;
    reads.push({ op: "verifyVersion", network: "base", rpcLatencyMs: ms, timestamp: nowIso() });
  }
  const readStats = statsOf(reads.map((r) => r.rpcLatencyMs));
  console.log(`  verifyVersion reads x${readSamples}: median ${readStats.median.toFixed(1)}ms p95 ${readStats.p95.toFixed(1)}ms`);

  // 5) Revoke one published version.
  await measureTx("revokeVersion", 1, () => registry.revokeVersion(nameA, versions[0]!));

  // 6) Register a second package and transfer it, so transfer is measured without losing A.
  const nameB = randomName("bench");
  await measureTx("registerPackage", 2, () => registry.registerPackage(nameB));
  const sink = Wallet.createRandom().address;
  await measureTx("transferOwnership", 1, () => registry.transferOwnership(nameB, sink));

  const results = {
    methodology: "base-mainnet-live",
    network: "base",
    chainId: BASE_CHAIN_ID,
    deployment: {
      contractAddress,
      txHash: deployTx.hash,
      deployer: address,
    },
    startedAt,
    finishedAt: nowIso(),
    observedGasPriceWei: gasPriceWei.toString(),
    ethUsdPrice,
    tx: txRuns,
    read: reads,
  };
  const outPath = resolve(__dirname, "..", "results", `registry-live-${Date.now()}.json`);
  writeJson(outPath, results);
  console.log(`\nWrote ${outPath}`);

  // Console summary per operation.
  const byOp = new Map<string, { gas: number[]; usd: number[]; confirm: number[] }>();
  for (const t of txRuns) {
    if (!byOp.has(t.op)) byOp.set(t.op, { gas: [], usd: [], confirm: [] });
    const b = byOp.get(t.op)!;
    b.gas.push(Number(t.gasUsed));
    b.usd.push(t.totalUsd);
    b.confirm.push(t.txConfirmMs);
  }
  console.log("\n=== Base mainnet (observed) ===");
  for (const [op, b] of byOp.entries()) {
    const g = statsOf(b.gas);
    const u = statsOf(b.usd);
    const c = statsOf(b.confirm);
    console.log(
      `  ${op.padEnd(18)} gas ${g.median.toFixed(0).padStart(8)}  ` +
        `cost $${u.median.toFixed(6)}  confirm median ${c.median.toFixed(0)}ms p95 ${c.p95.toFixed(0)}ms`,
    );
  }
  console.log(`  verifyVersion (read)  median ${readStats.median.toFixed(1)}ms p95 ${readStats.p95.toFixed(1)}ms`);
  console.log(`\n  contract: ${contractAddress}`);
  console.log(`  basescan: https://basescan.org/address/${contractAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Registry cost model benchmark.
 *
 * Write operations are executed only on local Anvil to measure deterministic
 * EVM gas. L2 mainnet RPCs are then queried read-only for live execution gas
 * price and L1 data fee estimates.
 *
 * Usage: tsx bench-registry.ts [--runs 5]
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import {
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  type ContractTransactionResponse,
  type InterfaceAbi,
} from "ethers";
import { getAnvilNetwork, getPricingNetworks, getPrivateKey, type L2PricingNetwork } from "./networks.js";
import {
  createProvider,
  estimateL1DataFee,
  validateChainId,
  type FeeEstimate,
  type RpcProvider,
  type SerializedTxInput,
} from "./l1-fee-model.js";
import { fetchEthUsdPrice, nowIso, writeJson } from "./util.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ABI_PATH = resolve(__dirname, "../../cli/abi/PackageRegistry.json");
const ABI = JSON.parse(readFileSync(ABI_PATH, "utf-8")) as InterfaceAbi;
const REGISTRY_INTERFACE = new Interface(ABI);

interface AnvilTxMeasurement {
  op: string;
  gasUsed: string;
  txConfirmMs: number;
  blockNumber: number;
  txHash: string;
  timestamp: string;
}

interface TxRun {
  op: string;
  sample: number;
  network: string;
  chainId: number;
  feeModel: L2PricingNetwork["feeModel"];
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
  serializedTxZeroBytes: number;
  serializedTxNonZeroBytes: number;
  anvilBlockNumber: number;
  anvilTxHash: string;
  timestamp: string;
  pricingTimestamp: string;
  arbitrumGasEstimateForL1?: string;
  arbitrumBaseFeeWei?: string;
}

interface ReadRun {
  op: string;
  network: string;
  rpcLatencyMs: number;
  timestamp: string;
}

interface Results {
  methodology: "anvil-gas-mainnet-fee-model";
  anvil: {
    network: string;
    chainId: number;
    contractAddress: string;
  };
  pricingNetworks: Array<{
    name: string;
    chainId: number;
    rpcUrl: string;
    feeModel: string;
  }>;
  startedAt: string;
  finishedAt: string;
  ethUsdPrice: number;
  tx: TxRun[];
  read: ReadRun[];
}

function randomHash(): string {
  return "0x" + createHash("sha256").update(randomBytes(32)).digest("hex");
}

function randomName(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}-${Date.now()}`;
}

async function getNonce(provider: JsonRpcProvider, addr: string): Promise<number> {
  const res: string = await provider.send("eth_getTransactionCount", [addr, "latest"]);
  return parseInt(res, 16);
}

async function measureAnvilTx(
  op: string,
  send: (nonce: number) => Promise<ContractTransactionResponse>,
  provider: JsonRpcProvider,
  signerAddr: string,
): Promise<AnvilTxMeasurement> {
  // Keep the explicit fresh nonce handling; auto-mining Anvil can otherwise race ethers' nonce cache.
  await new Promise((r) => setTimeout(r, 50));
  const nonce = await getNonce(provider, signerAddr);
  const t0 = performance.now();
  const tx = await send(nonce);
  const receipt = await tx.wait();
  const ms = performance.now() - t0;
  if (!receipt) throw new Error("no receipt");
  return {
    op,
    gasUsed: receipt.gasUsed.toString(),
    txConfirmMs: ms,
    blockNumber: receipt.blockNumber,
    txHash: receipt.hash,
    timestamp: nowIso(),
  };
}

function weiToUsd(wei: bigint, ethUsdPrice: number): number {
  return Number(wei) * ethUsdPrice / 1e18;
}

function buildModeledRun(
  op: string,
  sample: number,
  anvil: AnvilTxMeasurement,
  fee: FeeEstimate,
  ethUsdPrice: number,
): TxRun {
  const gasUsed = BigInt(anvil.gasUsed);
  const l2ExecutionFeeWei = gasUsed * fee.l2GasPriceWei;
  const totalFeeWei = l2ExecutionFeeWei + fee.l1DataFeeWei;
  return {
    op,
    sample,
    network: fee.network,
    chainId: fee.chainId,
    feeModel: fee.feeModel,
    gasUsed: anvil.gasUsed,
    txConfirmMs: anvil.txConfirmMs,
    l2GasPriceWei: fee.l2GasPriceWei.toString(),
    l2ExecutionFeeWei: l2ExecutionFeeWei.toString(),
    l1DataFeeWei: fee.l1DataFeeWei.toString(),
    totalFeeWei: totalFeeWei.toString(),
    ethUsdPrice,
    l2ExecutionUsd: weiToUsd(l2ExecutionFeeWei, ethUsdPrice),
    l1DataUsd: weiToUsd(fee.l1DataFeeWei, ethUsdPrice),
    totalUsd: weiToUsd(totalFeeWei, ethUsdPrice),
    serializedTxBytes: fee.serializedTxBytes,
    serializedTxZeroBytes: fee.serializedTxZeroBytes,
    serializedTxNonZeroBytes: fee.serializedTxNonZeroBytes,
    anvilBlockNumber: anvil.blockNumber,
    anvilTxHash: anvil.txHash,
    timestamp: anvil.timestamp,
    pricingTimestamp: fee.timestamp,
    arbitrumGasEstimateForL1: fee.arbitrumGasEstimateForL1,
    arbitrumBaseFeeWei: fee.arbitrumBaseFeeWei,
  };
}

function destroyProvider(provider: RpcProvider | JsonRpcProvider): void {
  const maybeDestroy = (provider as { destroy?: () => void }).destroy;
  if (maybeDestroy) maybeDestroy.call(provider);
}

async function modelCostsForOperation(
  op: string,
  sample: number,
  anvilMeasurement: AnvilTxMeasurement,
  txInput: SerializedTxInput,
  pricingNetworks: L2PricingNetwork[],
  providers: Map<string, RpcProvider>,
  wallet: Wallet,
  ethUsdPrice: number,
): Promise<TxRun[]> {
  const rows: TxRun[] = [];
  for (const network of pricingNetworks) {
    const provider = providers.get(network.name);
    if (!provider) throw new Error(`missing provider for ${network.name}`);
    console.log(`  pricing ${op} on ${network.name}...`);
    const fee = await estimateL1DataFee(network, provider, wallet, txInput);
    rows.push(buildModeledRun(op, sample, anvilMeasurement, fee, ethUsdPrice));
  }
  return rows;
}

async function main() {
  const runsArg = process.argv.indexOf("--runs");
  const RUNS = runsArg >= 0 ? parseInt(process.argv[runsArg + 1] ?? "5", 10) : 5;

  const anvil = getAnvilNetwork();
  const pricingNetworks = getPricingNetworks();
  const anvilProvider = new JsonRpcProvider(anvil.rpcUrl, anvil.chainId);
  const wallet = new Wallet(getPrivateKey(), anvilProvider);
  const signerAddr = await wallet.getAddress();
  const contract = new Contract(anvil.contractAddress, ABI, wallet) as unknown as {
    registerPackage: (n: string, opts?: object) => Promise<ContractTransactionResponse>;
    publishVersion: (n: string, v: string, h: string, opts?: object) => Promise<ContractTransactionResponse>;
    verifyVersion: (n: string, v: string) => Promise<[string, string, bigint, boolean]>;
    transferOwnership: (n: string, a: string, opts?: object) => Promise<ContractTransactionResponse>;
    revokeVersion: (n: string, v: string, opts?: object) => Promise<ContractTransactionResponse>;
  };

  const pricingProviders = new Map<string, RpcProvider>();
  for (const network of pricingNetworks) {
    const provider = createProvider(network);
    await validateChainId(provider, network);
    pricingProviders.set(network.name, provider);
  }

  const ethUsdPrice = await fetchEthUsdPrice();
  console.log(`[bench-registry] methodology=anvil-gas-mainnet-fee-model runs=${RUNS} ETH/USD=${ethUsdPrice}`);
  console.log(`[bench-registry] pricing networks=${pricingNetworks.map((n) => n.name).join(", ")}`);

  const results: Results = {
    methodology: "anvil-gas-mainnet-fee-model",
    anvil: {
      network: anvil.name,
      chainId: anvil.chainId,
      contractAddress: anvil.contractAddress,
    },
    pricingNetworks: pricingNetworks.map((n) => ({
      name: n.name,
      chainId: n.chainId,
      rpcUrl: n.rpcUrl,
      feeModel: n.feeModel,
    })),
    startedAt: nowIso(),
    finishedAt: "",
    ethUsdPrice,
    tx: [],
    read: [],
  };

  const sink = Wallet.createRandom().address;

  for (let i = 0; i < RUNS; i++) {
    const sample = i + 1;
    const name = randomName("bench");
    const version = "1.0.0";
    const hash = randomHash();

    console.log(`[${sample}/${RUNS}] ${name}`);

    const registerData = REGISTRY_INTERFACE.encodeFunctionData("registerPackage", [name]);
    const register = await measureAnvilTx(
      "registerPackage",
      (nonce) => contract.registerPackage(name, { nonce }),
      anvilProvider,
      signerAddr,
    );
    results.tx.push(...await modelCostsForOperation(
      "registerPackage",
      sample,
      register,
      { to: anvil.contractAddress, data: registerData, gasLimit: BigInt(register.gasUsed), nonce: i * 4 },
      pricingNetworks,
      pricingProviders,
      wallet,
      ethUsdPrice,
    ));

    const publishData = REGISTRY_INTERFACE.encodeFunctionData("publishVersion", [name, version, hash]);
    const publish = await measureAnvilTx(
      "publishVersion",
      (nonce) => contract.publishVersion(name, version, hash, { nonce }),
      anvilProvider,
      signerAddr,
    );
    results.tx.push(...await modelCostsForOperation(
      "publishVersion",
      sample,
      publish,
      { to: anvil.contractAddress, data: publishData, gasLimit: BigInt(publish.gasUsed), nonce: i * 4 + 1 },
      pricingNetworks,
      pricingProviders,
      wallet,
      ethUsdPrice,
    ));

    const t0 = performance.now();
    await contract.verifyVersion(name, version);
    const rms = performance.now() - t0;
    results.read.push({ op: "verifyVersion", network: anvil.name, rpcLatencyMs: rms, timestamp: nowIso() });

    const revokeData = REGISTRY_INTERFACE.encodeFunctionData("revokeVersion", [name, version]);
    const revoke = await measureAnvilTx(
      "revokeVersion",
      (nonce) => contract.revokeVersion(name, version, { nonce }),
      anvilProvider,
      signerAddr,
    );
    results.tx.push(...await modelCostsForOperation(
      "revokeVersion",
      sample,
      revoke,
      { to: anvil.contractAddress, data: revokeData, gasLimit: BigInt(revoke.gasUsed), nonce: i * 4 + 2 },
      pricingNetworks,
      pricingProviders,
      wallet,
      ethUsdPrice,
    ));

    const transferData = REGISTRY_INTERFACE.encodeFunctionData("transferOwnership", [name, sink]);
    const transfer = await measureAnvilTx(
      "transferOwnership",
      (nonce) => contract.transferOwnership(name, sink, { nonce }),
      anvilProvider,
      signerAddr,
    );
    results.tx.push(...await modelCostsForOperation(
      "transferOwnership",
      sample,
      transfer,
      { to: anvil.contractAddress, data: transferData, gasLimit: BigInt(transfer.gasUsed), nonce: i * 4 + 3 },
      pricingNetworks,
      pricingProviders,
      wallet,
      ethUsdPrice,
    ));
  }

  results.finishedAt = nowIso();
  const outPath = resolve(__dirname, "..", "results", `registry-modeled-${Date.now()}.json`);
  writeJson(outPath, results);
  for (const provider of pricingProviders.values()) destroyProvider(provider);
  destroyProvider(anvilProvider);
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

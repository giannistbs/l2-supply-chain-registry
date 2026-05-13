import {
  Contract,
  FetchRequest,
  JsonRpcProvider,
  Transaction,
  Wallet,
  WebSocketProvider,
  type InterfaceAbi,
  type TransactionRequest,
} from "ethers";
import type { L2PricingNetwork } from "./networks.js";

export type RpcProvider = JsonRpcProvider | WebSocketProvider;

const OP_STACK_GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F";
const SCROLL_L1_GAS_PRICE_ORACLE = "0x5300000000000000000000000000000000000002";
const ARBITRUM_NODE_INTERFACE = "0x00000000000000000000000000000000000000C8";

const L1_FEE_ORACLE_ABI: InterfaceAbi = [
  "function getL1Fee(bytes data) view returns (uint256)",
];

const ARBITRUM_NODE_INTERFACE_ABI: InterfaceAbi = [
  "function gasEstimateComponents(address to, bool contractCreation, bytes data) view returns (uint64 gasEstimate, uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)",
];

export interface SerializedTxInput {
  to: string;
  data: string;
  gasLimit: bigint;
  nonce: number;
}

export interface FeeEstimate {
  network: string;
  chainId: number;
  feeModel: L2PricingNetwork["feeModel"];
  l2GasPriceWei: bigint;
  l1DataFeeWei: bigint;
  serializedTxBytes: number;
  serializedTxZeroBytes: number;
  serializedTxNonZeroBytes: number;
  arbitrumGasEstimateForL1?: string;
  arbitrumBaseFeeWei?: string;
  timestamp: string;
}

export function createProvider(network: Pick<L2PricingNetwork, "rpcUrl" | "chainId">): RpcProvider {
  if (network.rpcUrl.startsWith("ws://") || network.rpcUrl.startsWith("wss://")) {
    return new WebSocketProvider(network.rpcUrl, network.chainId, {
      batchMaxCount: 1,
      staticNetwork: true,
    });
  }
  const request = new FetchRequest(network.rpcUrl);
  request.timeout = 15_000;
  return new JsonRpcProvider(request, network.chainId, {
    batchMaxCount: 1,
    staticNetwork: true,
  });
}

export async function validateChainId(provider: RpcProvider, network: L2PricingNetwork): Promise<void> {
  const actual = Number((await provider.getNetwork()).chainId);
  if (actual !== network.chainId) {
    throw new Error(`${network.name} RPC chainId mismatch: expected ${network.chainId}, got ${actual}`);
  }
}

export async function estimateL1DataFee(
  network: L2PricingNetwork,
  provider: RpcProvider,
  wallet: Wallet,
  tx: SerializedTxInput,
): Promise<FeeEstimate> {
  const gasPriceHex = await provider.send("eth_gasPrice", []);
  const l2GasPriceWei = BigInt(gasPriceHex);

  const signedTx = await signPricingTx(network, wallet, tx, l2GasPriceWei);
  const bytes = Buffer.from(signedTx.slice(2), "hex");
  const zeroBytes = bytes.filter((b) => b === 0).length;
  const nonZeroBytes = bytes.length - zeroBytes;

  if (network.feeModel === "op-stack") {
    const oracle = new Contract(OP_STACK_GAS_PRICE_ORACLE, L1_FEE_ORACLE_ABI, provider);
    const l1DataFeeWei = await oracle.getL1Fee(signedTx) as bigint;
    return {
      network: network.name,
      chainId: network.chainId,
      feeModel: network.feeModel,
      l2GasPriceWei,
      l1DataFeeWei,
      serializedTxBytes: bytes.length,
      serializedTxZeroBytes: zeroBytes,
      serializedTxNonZeroBytes: nonZeroBytes,
      timestamp: new Date().toISOString(),
    };
  }

  if (network.feeModel === "scroll") {
    const oracle = new Contract(SCROLL_L1_GAS_PRICE_ORACLE, L1_FEE_ORACLE_ABI, provider);
    const l1DataFeeWei = await oracle.getL1Fee(signedTx) as bigint;
    return {
      network: network.name,
      chainId: network.chainId,
      feeModel: network.feeModel,
      l2GasPriceWei,
      l1DataFeeWei,
      serializedTxBytes: bytes.length,
      serializedTxZeroBytes: zeroBytes,
      serializedTxNonZeroBytes: nonZeroBytes,
      timestamp: new Date().toISOString(),
    };
  }

  const nodeInterface = new Contract(ARBITRUM_NODE_INTERFACE, ARBITRUM_NODE_INTERFACE_ABI, provider);
  const [, gasEstimateForL1, baseFee] = await nodeInterface.gasEstimateComponents(tx.to, false, tx.data) as [
    bigint,
    bigint,
    bigint,
    bigint,
  ];
  return {
    network: network.name,
    chainId: network.chainId,
    feeModel: network.feeModel,
    l2GasPriceWei,
    l1DataFeeWei: gasEstimateForL1 * baseFee,
    serializedTxBytes: bytes.length,
    serializedTxZeroBytes: zeroBytes,
    serializedTxNonZeroBytes: nonZeroBytes,
    arbitrumGasEstimateForL1: gasEstimateForL1.toString(),
    arbitrumBaseFeeWei: baseFee.toString(),
    timestamp: new Date().toISOString(),
  };
}

async function signPricingTx(
  network: L2PricingNetwork,
  wallet: Wallet,
  tx: SerializedTxInput,
  gasPrice: bigint,
): Promise<string> {
  const request: TransactionRequest = {
    type: 2,
    chainId: network.chainId,
    nonce: tx.nonce,
    to: tx.to,
    data: tx.data,
    value: 0n,
    gasLimit: tx.gasLimit,
    maxPriorityFeePerGas: 0n,
    maxFeePerGas: gasPrice,
  };
  const signed = await wallet.signTransaction(request);
  return Transaction.from(signed).serialized;
}

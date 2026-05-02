import { connect } from "../lib/contract.js";
import { loadConfigWithOverrides } from "../lib/config.js";
import { computeSHA256 } from "../lib/hash.js";
import type { VerifyResult } from "../types/index.js";

interface Options {
  network: string;
  contract?: string;
  rpcUrl?: string;
  json?: boolean;
}

export async function verifyCommand(
  name: string,
  version: string,
  filepath: string,
  opts: Options,
): Promise<number> {
  const cfg = loadConfigWithOverrides(opts.network, { contract: opts.contract, rpcUrl: opts.rpcUrl });
  const { contract } = connect(cfg);

  const localHash = await computeSHA256(filepath);

  const start = performance.now();
  const [onChainHash, owner, timestamp, revoked] = (await contract.verifyVersion(name, version)) as [
    string,
    string,
    bigint,
    boolean,
  ];
  const rpcLatencyMs = performance.now() - start;

  const match = localHash.toLowerCase() === onChainHash.toLowerCase();
  const result: VerifyResult = {
    match,
    localHash,
    onChainHash,
    owner,
    timestamp: Number(timestamp),
    revoked,
    rpcLatencyMs,
  };

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(match ? "MATCH" : "MISMATCH");
    console.log(`  local hash:     ${localHash}`);
    console.log(`  on-chain hash:  ${onChainHash}`);
    console.log(`  owner:          ${owner}`);
    console.log(`  published at:   ${new Date(Number(timestamp) * 1000).toISOString()}`);
    console.log(`  revoked:        ${revoked}`);
    console.log(`  rpc latency:    ${rpcLatencyMs.toFixed(1)} ms`);
    if (revoked) console.log("  WARNING: this version has been revoked by the maintainer.");
  }
  return match ? 0 : 1;
}

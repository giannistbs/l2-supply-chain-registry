import { connect, sendTx, formatReceipt } from "../lib/contract.js";
import { loadConfigWithOverrides } from "../lib/config.js";
import { computeSHA256 } from "../lib/hash.js";

interface Options {
  network: string;
  contract?: string;
  rpcUrl?: string;
}

export async function publishCommand(
  name: string,
  version: string,
  filepath: string,
  opts: Options,
): Promise<void> {
  const cfg = loadConfigWithOverrides(opts.network, { contract: opts.contract, rpcUrl: opts.rpcUrl });
  const { contract } = connect(cfg);

  const hashStart = performance.now();
  const hash = await computeSHA256(filepath);
  const hashMs = performance.now() - hashStart;
  console.log(`SHA-256(${filepath}) = ${hash}`);
  console.log(`  hashing time: ${hashMs.toFixed(1)} ms`);

  console.log(`Publishing ${name}@${version} on ${cfg.network.name}...`);
  const r = await sendTx(contract.publishVersion(name, version, hash));
  console.log(formatReceipt(r));
}

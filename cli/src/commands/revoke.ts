import { connect, sendTx, formatReceipt } from "../lib/contract.js";
import { loadConfigWithOverrides } from "../lib/config.js";

interface Options {
  network: string;
  contract?: string;
  rpcUrl?: string;
}

export async function revokeCommand(name: string, version: string, opts: Options): Promise<void> {
  const cfg = loadConfigWithOverrides(opts.network, { contract: opts.contract, rpcUrl: opts.rpcUrl });
  const { contract } = connect(cfg);
  console.log(`Revoking ${name}@${version} on ${cfg.network.name}...`);
  const r = await sendTx(contract.revokeVersion(name, version));
  console.log(formatReceipt(r));
}

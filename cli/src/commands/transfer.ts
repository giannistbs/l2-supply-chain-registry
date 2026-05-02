import { connect, sendTx, formatReceipt } from "../lib/contract.js";
import { loadConfigWithOverrides } from "../lib/config.js";

interface Options {
  network: string;
  contract?: string;
  rpcUrl?: string;
}

export async function transferCommand(name: string, newOwner: string, opts: Options): Promise<void> {
  const cfg = loadConfigWithOverrides(opts.network, { contract: opts.contract, rpcUrl: opts.rpcUrl });
  const { contract } = connect(cfg);
  console.log(`Transferring '${name}' ownership to ${newOwner} on ${cfg.network.name}...`);
  const r = await sendTx(contract.transferOwnership(name, newOwner));
  console.log(formatReceipt(r));
}

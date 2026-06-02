import { connect, sendTx, formatReceipt } from "../lib/contract.js";
import { loadConfigWithOverrides } from "../lib/config.js";

interface Options {
  network: string;
  contract?: string;
  rpcUrl?: string;
}

export async function registerCommand(name: string, opts: Options): Promise<void> {
  const cfg = loadConfigWithOverrides(opts.network, { contract: opts.contract, rpcUrl: opts.rpcUrl });
  const { contract } = connect(cfg);

  console.log(`Registering package '${name}' on ${cfg.network.name}...`);
  const r = await sendTx(contract.registerPackage(name));
  console.log(formatReceipt(r));
}

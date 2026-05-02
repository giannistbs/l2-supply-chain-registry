import { connect, sendTx, formatReceipt } from "../lib/contract.js";
import { loadConfigWithOverrides } from "../lib/config.js";

interface Options {
  network: string;
  contract?: string;
  rpcUrl?: string;
  ensureMaintainer?: boolean;
}

export async function registerCommand(name: string, opts: Options): Promise<void> {
  const cfg = loadConfigWithOverrides(opts.network, { contract: opts.contract, rpcUrl: opts.rpcUrl });
  const { contract, wallet } = connect(cfg);

  if (opts.ensureMaintainer) {
    const isReg = await contract.isRegisteredMaintainer(await wallet.getAddress());
    if (!isReg) {
      console.log("Registering maintainer (did:ethr opt-in)...");
      const r = await sendTx(contract.registerMaintainer());
      console.log(formatReceipt(r));
    }
  }

  console.log(`Registering package '${name}' on ${cfg.network.name}...`);
  const r = await sendTx(contract.registerPackage(name));
  console.log(formatReceipt(r));
}

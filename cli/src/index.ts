#!/usr/bin/env node
import { Command } from "commander";
import { registerCommand } from "./commands/register.js";
import { publishCommand } from "./commands/publish.js";
import { verifyCommand } from "./commands/verify.js";
import { transferCommand } from "./commands/transfer.js";
import { revokeCommand } from "./commands/revoke.js";
import { listNetworks } from "./lib/config.js";

const program = new Command();
program
  .name("registry")
  .description("CLI for the Ethereum L2 Package Integrity Registry")
  .version("0.1.0");

const networks = listNetworks().join("|");
const commonNetworkOpts = (cmd: Command) =>
  cmd
    .requiredOption("-n, --network <name>", `target network (${networks})`, "anvil")
    .option("-c, --contract <address>", "override the registry contract address")
    .option("--rpc-url <url>", "override the RPC endpoint");

commonNetworkOpts(
  program
    .command("register <name>")
    .description("register a new package name"),
).action((name, opts) => registerCommand(name, opts));

commonNetworkOpts(
  program
    .command("publish <name> <version> <filepath>")
    .description("publish a version: hashes the file, stores the hash on-chain"),
).action((name, version, filepath, opts) => publishCommand(name, version, filepath, opts));

commonNetworkOpts(
  program
    .command("verify <name> <version> <filepath>")
    .description("verify a local file against the on-chain hash")
    .option("--json", "emit result as JSON", false),
).action(async (name, version, filepath, opts) => {
  const code = await verifyCommand(name, version, filepath, opts);
  process.exit(code);
});

commonNetworkOpts(
  program
    .command("transfer <name> <new-owner>")
    .description("transfer package ownership to a new address"),
).action((name, newOwner, opts) => transferCommand(name, newOwner, opts));

commonNetworkOpts(
  program
    .command("revoke <name> <version>")
    .description("mark a version as compromised/revoked"),
).action((name, version, opts) => revokeCommand(name, version, opts));

program.parseAsync(process.argv).catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});

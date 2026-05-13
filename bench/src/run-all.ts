/**
 * Orchestrator: runs all three benchmark harnesses sequentially.
 * Registry cost modeling uses Anvil for execution and L2 mainnet RPCs for pricing.
 * Then runs analysis.ts to build summary tables.
 *
 * Usage: tsx run-all.ts [--registry-runs 5] [--external-runs 50]
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPricingNetworks } from "./networks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function run(script: string, args: string[]): void {
  console.log(`\n=== ${script} ${args.join(" ")} ===`);
  const r = spawnSync("npx", ["tsx", resolve(__dirname, script), ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    console.error(`[run-all] ${script} exited with ${r.status}`);
  }
}

function main() {
  const registryRunsArg = process.argv.indexOf("--registry-runs");
  const externalRunsArg = process.argv.indexOf("--external-runs");
  const legacyRunsArg = process.argv.indexOf("--runs");
  const registryRuns = registryRunsArg >= 0
    ? (process.argv[registryRunsArg + 1] ?? "5")
    : legacyRunsArg >= 0
      ? (process.argv[legacyRunsArg + 1] ?? "5")
      : "5";
  const externalRuns = externalRunsArg >= 0
    ? (process.argv[externalRunsArg + 1] ?? "50")
    : legacyRunsArg >= 0
      ? (process.argv[legacyRunsArg + 1] ?? "50")
      : "50";

  const pricingNetworks = getPricingNetworks();
  console.log(`[run-all] registry runs=${registryRuns}, external runs=${externalRuns}`);
  console.log(`[run-all] pricing networks: ${pricingNetworks.map((n) => n.name).join(", ")}`);

  run("bench-registry.ts", ["--runs", registryRuns]);
  run("bench-sigstore.ts", ["--runs", externalRuns]);
  run("bench-npm.ts", ["--runs", externalRuns]);
  run("analysis.ts", []);
}

main();

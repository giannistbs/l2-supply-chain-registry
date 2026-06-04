/**
 * Aggregate all JSON result files in bench/results/ into summary tables (CSV + JSON).
 * Emits:
 *   summary-ops.csv       per-operation mean/median/p95/p99 for gas, latency, USD
 *   summary-ops.json      same, JSON
 *   projections.csv       USD cost at 1K / 10K / 100K / 1M / 2M package scales
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { statsOf, type Stats } from "./util.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, "..", "results");

interface RegistryFile {
  methodology: string;
  tx: Array<{
    op: string;
    network: string;
    gasUsed: string;
    txConfirmMs: number;
    l2ExecutionUsd: number;
    l1DataUsd: number;
    totalUsd: number;
    l2ExecutionFeeWei: string;
    l1DataFeeWei: string;
    totalFeeWei: string;
    serializedTxBytes: number;
  }>;
  read: Array<{ op: string; rpcLatencyMs: number }>;
}
interface SigstoreFile {
  runs: Array<{ op: string; latencyMs: number; status: number }>;
}
interface NpmFile {
  runs: Array<{ op: string; pkg: string; latencyMs: number; bytes?: number }>;
}

interface Row {
  source: string;
  network: string;
  op: string;
  metric: string;
  stats: Stats;
  unit: string;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function toCsv(rows: Row[]): string {
  const header = [
    "source",
    "network",
    "op",
    "metric",
    "unit",
    "count",
    "mean",
    "median",
    "p95",
    "p99",
    "min",
    "max",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.source,
        r.network,
        r.op,
        r.metric,
        r.unit,
        r.stats.count,
        r.stats.mean.toFixed(6),
        r.stats.median.toFixed(6),
        r.stats.p95.toFixed(6),
        r.stats.p99.toFixed(6),
        r.stats.min.toFixed(6),
        r.stats.max.toFixed(6),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

interface OpAccumulator {
  gas: number[];
  latency: number[];
  totalUsd: number[];
  l2Usd: number[];
  l1Usd: number[];
  l2Wei: number[];
  l1Wei: number[];
  totalWei: number[];
  serializedBytes: number[];
}

/**
 * Aggregate a registry result file (modeled or live) into summary rows.
 * `source` distinguishes modeled ("registry") from live Base ("registry-live").
 * `readNetwork` labels the verifyVersion read row. When `publishMedianUsdByNetwork`
 * is provided, the publishVersion median feeds the projection table; live runs pass
 * null so projections stay anchored to the modeled figures.
 */
function aggregateRegistry(
  data: RegistryFile,
  source: string,
  readNetwork: string,
  rows: Row[],
  publishMedianUsdByNetwork: Record<string, number> | null,
): void {
  const byOp = new Map<string, OpAccumulator>();
  for (const t of data.tx) {
    const key = `${t.network}/${t.op}`;
    if (!byOp.has(key)) {
      byOp.set(key, { gas: [], latency: [], totalUsd: [], l2Usd: [], l1Usd: [], l2Wei: [], l1Wei: [], totalWei: [], serializedBytes: [] });
    }
    const b = byOp.get(key)!;
    b.gas.push(Number(t.gasUsed));
    b.latency.push(t.txConfirmMs);
    b.totalUsd.push(t.totalUsd);
    b.l2Usd.push(t.l2ExecutionUsd);
    b.l1Usd.push(t.l1DataUsd);
    b.l2Wei.push(Number(t.l2ExecutionFeeWei));
    b.l1Wei.push(Number(t.l1DataFeeWei));
    b.totalWei.push(Number(t.totalFeeWei));
    b.serializedBytes.push(t.serializedTxBytes);
  }
  for (const [key, b] of byOp.entries()) {
    const slash = key.indexOf("/");
    const network = key.slice(0, slash);
    const op = key.slice(slash + 1);
    rows.push({ source, network, op, metric: "gasUsed", unit: "gas", stats: statsOf(b.gas) });
    rows.push({ source, network, op, metric: "txConfirmMs", unit: "ms", stats: statsOf(b.latency) });
    rows.push({ source, network, op, metric: "l2ExecutionUsd", unit: "USD", stats: statsOf(b.l2Usd) });
    rows.push({ source, network, op, metric: "l1DataUsd", unit: "USD", stats: statsOf(b.l1Usd) });
    rows.push({ source, network, op, metric: "totalUsd", unit: "USD", stats: statsOf(b.totalUsd) });
    rows.push({ source, network, op, metric: "l2ExecutionFeeWei", unit: "wei", stats: statsOf(b.l2Wei) });
    rows.push({ source, network, op, metric: "l1DataFeeWei", unit: "wei", stats: statsOf(b.l1Wei) });
    rows.push({ source, network, op, metric: "totalFeeWei", unit: "wei", stats: statsOf(b.totalWei) });
    rows.push({ source, network, op, metric: "serializedTxBytes", unit: "bytes", stats: statsOf(b.serializedBytes) });
    if (publishMedianUsdByNetwork && op === "publishVersion") {
      publishMedianUsdByNetwork[network] = statsOf(b.totalUsd).median;
    }
  }
  const reads = data.read.map((r) => r.rpcLatencyMs);
  if (reads.length) {
    rows.push({ source, network: readNetwork, op: "verifyVersion", metric: "rpcLatencyMs", unit: "ms", stats: statsOf(reads) });
  }
}

function main() {
  const files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"));
  const rows: Row[] = [];
  const publishMedianUsdByNetwork: Record<string, number> = {};

  for (const f of files) {
    const path = join(RESULTS_DIR, f);
    if (f.startsWith("registry-modeled-")) {
      aggregateRegistry(loadJson<RegistryFile>(path), "registry", "anvil", rows, publishMedianUsdByNetwork);
    } else if (f.startsWith("registry-live-")) {
      aggregateRegistry(loadJson<RegistryFile>(path), "registry-live", "base", rows, null);
    } else if (f.startsWith("sigstore-")) {
      const data = loadJson<SigstoreFile>(path);
      const byOp = new Map<string, number[]>();
      for (const r of data.runs) {
        if (!byOp.has(r.op)) byOp.set(r.op, []);
        byOp.get(r.op)!.push(r.latencyMs);
      }
      for (const [op, lats] of byOp.entries()) {
        rows.push({ source: "sigstore", network: "rekor-public", op, metric: "latencyMs", unit: "ms", stats: statsOf(lats) });
      }
    } else if (f.startsWith("npm-")) {
      const data = loadJson<NpmFile>(path);
      const byOp = new Map<string, number[]>();
      for (const r of data.runs) {
        const key = `${r.op}/${r.pkg}`;
        if (!byOp.has(key)) byOp.set(key, []);
        byOp.get(key)!.push(r.latencyMs);
      }
      for (const [key, lats] of byOp.entries()) {
        rows.push({ source: "npm", network: "registry.npmjs.org", op: key, metric: "latencyMs", unit: "ms", stats: statsOf(lats) });
      }
    }
  }

  writeFileSync(join(RESULTS_DIR, "summary-ops.csv"), toCsv(rows));
  writeFileSync(join(RESULTS_DIR, "summary-ops.json"), JSON.stringify(rows, null, 2));

  // Projections for package-version publication events per L2.
  const scales = [1_000, 10_000, 100_000, 1_000_000, 2_000_000];
  const projLines = ["scale_packages,network,total_usd_publish_median"];
  for (const [network, medianUsd] of Object.entries(publishMedianUsdByNetwork)) {
    for (const s of scales) {
      projLines.push(`${s},${network},${(s * medianUsd).toFixed(2)}`);
    }
  }
  writeFileSync(join(RESULTS_DIR, "projections.csv"), projLines.join("\n") + "\n");

  console.log(`Wrote summary-ops.csv (${rows.length} rows), summary-ops.json, projections.csv`);
}

main();

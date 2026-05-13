/**
 * npm registry baseline benchmarks.
 *
 * For a set of real packages (default: lodash, express, react), measure:
 *   - metadata fetch: GET /<pkg>
 *   - version fetch:  GET /<pkg>/<version>
 *   - tarball download + SHA-512 recompute (npm tarballs ship sha512 integrity)
 *
 * Usage: tsx bench-npm.ts [--runs 50] [--packages lodash,express,react]
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { nowIso, writeJson, timeIt } from "./util.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY = process.env.NPM_REGISTRY ?? "https://registry.npmjs.org";

interface Run {
  op: string;
  pkg: string;
  version?: string;
  latencyMs: number;
  bytes?: number;
  hashMatch?: boolean;
  timestamp: string;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

async function main() {
  const RUNS = parseInt(arg("runs", "50"), 10);
  const PACKAGES = arg("packages", "lodash,express,react").split(",").map((p) => p.trim()).filter(Boolean);

  console.log(`[bench-npm] registry=${REGISTRY} runs=${RUNS} packages=${PACKAGES.join(",")}`);

  const results: { startedAt: string; finishedAt: string; registry: string; runs: Run[] } = {
    startedAt: nowIso(),
    finishedAt: "",
    registry: REGISTRY,
    runs: [],
  };

  // Resolve latest version + tarball URL per package once.
  const meta: Record<string, { version: string; tarballUrl: string; integrity: string }> = {};
  for (const pkg of PACKAGES) {
    const r = await fetch(`${REGISTRY}/${pkg}/latest`);
    if (!r.ok) throw new Error(`failed to fetch ${pkg}: ${r.status}`);
    const j = (await r.json()) as {
      version: string;
      dist: { tarball: string; integrity: string };
    };
    meta[pkg] = { version: j.version, tarballUrl: j.dist.tarball, integrity: j.dist.integrity };
    console.log(`  resolved ${pkg}@${j.version} -> ${j.dist.tarball}`);
  }

  for (let i = 0; i < RUNS; i++) {
    for (const pkg of PACKAGES) {
      const { version, tarballUrl, integrity } = meta[pkg]!;

      const m = await timeIt(() => fetch(`${REGISTRY}/${pkg}`));
      results.runs.push({ op: "metadataFetch", pkg, latencyMs: m.ms, timestamp: nowIso() });
      await m.result.arrayBuffer(); // drain

      const v = await timeIt(() => fetch(`${REGISTRY}/${pkg}/${version}`));
      results.runs.push({ op: "versionFetch", pkg, version, latencyMs: v.ms, timestamp: nowIso() });
      await v.result.arrayBuffer();

      const t0 = performance.now();
      const tarRes = await fetch(tarballUrl);
      const buf = Buffer.from(await tarRes.arrayBuffer());
      const ms = performance.now() - t0;

      // npm integrity is "sha512-<base64>"
      let hashMatch = false;
      const m2 = /^sha512-(.+)$/.exec(integrity);
      if (m2) {
        const expected = Buffer.from(m2[1], "base64").toString("hex");
        const actual = createHash("sha512").update(buf).digest("hex");
        hashMatch = expected === actual;
      }
      results.runs.push({
        op: "tarballDownloadAndHash",
        pkg,
        version,
        latencyMs: ms,
        bytes: buf.length,
        hashMatch,
        timestamp: nowIso(),
      });
    }
    if ((i + 1) % 10 === 0) console.log(`  progress ${i + 1}/${RUNS}`);
  }

  results.finishedAt = nowIso();
  const outPath = resolve(__dirname, "..", "results", `npm-${Date.now()}.json`);
  writeJson(outPath, results);
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

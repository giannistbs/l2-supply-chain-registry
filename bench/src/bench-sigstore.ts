/**
 * Sigstore/Rekor benchmarks (read-side only).
 *
 * We measure latency of public Rekor API operations that any verifier would
 * perform. Publishing to Rekor requires Fulcio OIDC-based keyless signing,
 * which is intentionally out of scope for an unattended benchmark — we use
 * pre-existing log entries instead. Publisher-side cost in Sigstore is
 * effectively zero (no fees), so the comparison focuses on verification
 * latency against the L2 verifyVersion call.
 *
 * Operations measured:
 *   - fetchLogInfo:   GET /api/v1/log
 *   - searchByHash:   POST /api/v1/index/retrieve  (canonical verifier flow)
 *   - fetchLogEntry:  GET /api/v1/log/entries/<uuid>
 *
 * Usage: tsx bench-sigstore.ts [--runs 50]
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { nowIso, writeJson, timeIt } from "./util.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REKOR = process.env.REKOR_URL ?? "https://rekor.sigstore.dev";

interface OpRun {
  op: string;
  latencyMs: number;
  status: number;
  timestamp: string;
  note?: string;
}

async function timedFetch(op: string, url: string, init?: RequestInit): Promise<OpRun> {
  const { result: res, ms } = await timeIt(() => fetch(url, init));
  return { op, latencyMs: ms, status: res.status, timestamp: nowIso() };
}

async function main() {
  const runsArg = process.argv.indexOf("--runs");
  const RUNS = runsArg >= 0 ? parseInt(process.argv[runsArg + 1] ?? "50", 10) : 50;
  console.log(`[bench-sigstore] REKOR=${REKOR} runs=${RUNS}`);

  const results: { startedAt: string; finishedAt: string; rekorUrl: string; runs: OpRun[] } = {
    startedAt: nowIso(),
    finishedAt: "",
    rekorUrl: REKOR,
    runs: [],
  };

  // Fetch log info to discover a valid UUID to replay reads against.
  let sampleUuid: string | undefined;
  {
    const r = await fetch(`${REKOR}/api/v1/log/entries?logIndex=0`);
    if (r.ok) {
      const body = (await r.json()) as Record<string, unknown>;
      sampleUuid = Object.keys(body)[0];
      console.log(`[bench-sigstore] sample UUID: ${sampleUuid}`);
    } else {
      console.warn(`[bench-sigstore] could not fetch sample entry: ${r.status}`);
    }
  }

  for (let i = 0; i < RUNS; i++) {
    results.runs.push(await timedFetch("fetchLogInfo", `${REKOR}/api/v1/log`));

    // Simulate the "did a verifier see this hash in the log?" flow by POSTing a
    // random sha256 to /api/v1/index/retrieve. Response will be an empty array
    // for a random hash but the network round-trip is what matters.
    const randHash = createHash("sha256").update(`${Date.now()}-${i}`).digest("hex");
    results.runs.push(
      await timedFetch("searchByHash", `${REKOR}/api/v1/index/retrieve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hash: `sha256:${randHash}` }),
      }),
    );

    if (sampleUuid) {
      results.runs.push(
        await timedFetch("fetchLogEntry", `${REKOR}/api/v1/log/entries/${sampleUuid}`),
      );
    }

    if ((i + 1) % 10 === 0) console.log(`  progress ${i + 1}/${RUNS}`);
  }

  results.finishedAt = nowIso();
  const outPath = resolve(__dirname, "..", "results", `sigstore-${Date.now()}.json`);
  writeJson(outPath, results);
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

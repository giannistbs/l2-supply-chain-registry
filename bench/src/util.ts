import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export interface Stats {
  count: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
}

export function statsOf(values: number[]): Stats {
  if (values.length === 0) {
    return { count: 0, mean: 0, median: 0, p95: 0, p99: 0, min: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return {
    count: sorted.length,
    mean,
    median: pct(50),
    p95: pct(95),
    p99: pct(99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

export function writeJson(path: string, data: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2),
  );
}

export async function fetchEthUsdPrice(): Promise<number> {
  let json: { ethereum?: { usd?: number } };
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = (await res.json()) as { ethereum?: { usd?: number } };
  } catch (err) {
    throw new Error(
      `Failed to fetch ETH/USD price from CoinGecko: ${err instanceof Error ? err.message : String(err)}. ` +
        `Aborting so USD figures are not silently zeroed.`,
    );
  }
  const price = json.ethereum?.usd;
  if (!price || price <= 0) {
    throw new Error(
      `CoinGecko returned an invalid ETH/USD price (${price}). Aborting so USD figures are not silently zeroed.`,
    );
  }
  return price;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function timeIt<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - t0 };
}

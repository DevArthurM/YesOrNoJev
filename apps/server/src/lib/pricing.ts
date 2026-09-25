import { FREE_CREDIT_USD, type PricingInfo } from "@yesornojev/shared";
import benchmark from "../data/benchmark.json" with { type: "json" };

export interface Benchmark {
  model: string;
  modelVersion: string;
  averageCostUsd: number;
  averageInputTokens: number;
  sampleSize: number;
  measuredAt: string;
  source: string;
}

export function loadBenchmark(): Benchmark {
  return benchmark as Benchmark;
}

export function rowsForBudget(budgetUsd: number, averageCostUsd: number): number {
  if (!(averageCostUsd > 0)) return 0;
  return Math.floor(budgetUsd / averageCostUsd);
}

export function toPricingInfo(data: Benchmark): PricingInfo {
  return {
    model: data.model,
    averageCostUsd: data.averageCostUsd,
    sampleSize: data.sampleSize,
    measuredAt: data.measuredAt,
    freeCreditUsd: FREE_CREDIT_USD,
    rowsForFreeCredit: rowsForBudget(FREE_CREDIT_USD, data.averageCostUsd),
  };
}

/**
 * Live per-token price for the JEV model, read from the public `GET /v1/models` listing.
 * Used to show a running cost estimate while a job runs. Falls back to the benchmark.
 */
export function createPriceLookup(apiBase: string, model: string, fetchImpl: typeof fetch = fetch) {
  let cached: { perInputTokenUsd: number; at: number } | undefined;
  const fallback = () => {
    const data = loadBenchmark();
    return data.averageInputTokens > 0 ? data.averageCostUsd / data.averageInputTokens : 0;
  };

  return async function perInputTokenUsd(): Promise<number> {
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.perInputTokenUsd;
    try {
      const res = await fetchImpl(`${apiBase}/v1/models`, { signal: AbortSignal.timeout(5000) });
      const json = (await res.json()) as { data?: { id: string; pricing?: { input_per_mtok_usd?: number } }[] };
      const perMillion = json.data?.find((m) => m.id === model)?.pricing?.input_per_mtok_usd;
      if (typeof perMillion !== "number") return fallback();
      cached = { perInputTokenUsd: perMillion / 1_000_000, at: Date.now() };
      return cached.perInputTokenUsd;
    } catch {
      return fallback();
    }
  };
}

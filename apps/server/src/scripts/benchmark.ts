/**
 * Cost benchmark: sends 10 real JEV requests over the first rows of a CSV you provide and
 * records the average billed cost per row in src/data/benchmark.json (used by the welcome screen).
 *
 * The billed cost is read back from impossibl's request log (`GET /v1/requests`,
 * `costCredits` in micro-USD). If the log is unavailable it falls back to
 * input tokens x the live model price from `GET /v1/models`.
 *
 * Usage: npm run benchmark -- path/to/file.csv ["Your yes/no question?"]
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readEnv } from "../env.js";
import { createJevClient } from "../lib/jev.js";
import { createPriceLookup, rowsForBudget, type Benchmark } from "../lib/pricing.js";
import { FREE_CREDIT_USD, type RowData } from "@yesornojev/shared";

const SAMPLE_SIZE = 10;
const outputPath = fileURLToPath(new URL("../data/benchmark.json", import.meta.url));

function parseSimpleCsv(text: string): RowData[] {
  const splitLine = (line: string) => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (quoted && char === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) {
        cells.push(cell);
        cell = "";
      } else cell += char;
    }
    cells.push(cell);
    return cells;
  };
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const columns = splitLine(header ?? "");
  return lines.map((line) => Object.fromEntries(splitLine(line).map((value, i) => [columns[i] ?? `column_${i}`, value])));
}

async function main() {
  const env = readEnv();
  if (!env.serverKey) throw new Error("IMPOSSIBL_API_KEY is missing. Add it to .env first.");

  const [csvArg, questionArg] = process.argv.slice(2);
  if (!csvArg) throw new Error('Pass a CSV to measure with: npm run benchmark -- path/to/file.csv ["Your question?"]');
  // npm runs workspace scripts from apps/server; resolve paths from where the command was typed.
  const csvPath = resolve(process.env.INIT_CWD ?? process.cwd(), csvArg);
  const QUESTION = questionArg?.trim() || "Is this statement true for this record?";
  const rows = parseSimpleCsv(await readFile(csvPath, "utf8")).slice(0, SAMPLE_SIZE);
  if (rows.length === 0) throw new Error(`${csvPath} has no rows.`);
  const askJev = createJevClient({ apiBase: env.apiBase, model: env.model });
  const startedAt = new Date(Date.now() - 1000).toISOString();

  console.log(`Sending ${rows.length} JEV requests to ${env.model}: "${QUESTION}"`);
  const answers = [];
  for (const [i, row] of rows.entries()) {
    const answer = await askJev(env.serverKey, QUESTION, row);
    answers.push(answer);
    console.log(`  #${i + 1} -> ${answer.verdict.padEnd(3)} p=${answer.probability.toFixed(2)} tokens=${answer.inputTokens}`);
  }

  const averageInputTokens = answers.reduce((sum, a) => sum + a.inputTokens, 0) / answers.length;
  let averageCostUsd: number | undefined;
  let source = "request log (costCredits)";

  // The request log is eventually consistent; give it a moment to catch up.
  for (let attempt = 0; attempt < 5 && averageCostUsd === undefined; attempt++) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(
      `${env.apiBase}/v1/requests?limit=50&status=ok&model=${encodeURIComponent(env.model)}&since=${encodeURIComponent(startedAt)}`,
      { headers: { authorization: `Bearer ${env.serverKey}` } },
    );
    if (!res.ok) break;
    const log = (await res.json()) as { data?: { costCredits?: number; endpoint?: string }[] };
    const billed = (log.data ?? []).filter((r) => r.endpoint === "/v1/systemone" && typeof r.costCredits === "number");
    if (billed.length >= answers.length) {
      const credits = billed.slice(0, answers.length).reduce((sum, r) => sum + (r.costCredits ?? 0), 0);
      averageCostUsd = credits / 1_000_000 / answers.length;
    }
  }

  if (averageCostUsd === undefined) {
    source = "input tokens x GET /v1/models price";
    const perToken = await createPriceLookup(env.apiBase, env.model)();
    averageCostUsd = averageInputTokens * perToken;
  }

  const benchmark: Benchmark = {
    model: env.model,
    modelVersion: answers[0]?.modelVersion ?? "unknown",
    averageCostUsd: Number(averageCostUsd.toPrecision(6)),
    averageInputTokens: Math.round(averageInputTokens),
    sampleSize: answers.length,
    measuredAt: new Date().toISOString(),
    source,
  };
  await writeFile(outputPath, `${JSON.stringify(benchmark, null, 2)}\n`);

  console.log(`\nAverage cost per row: $${averageCostUsd.toFixed(8)} (${source})`);
  console.log(`$${FREE_CREDIT_USD} answers ~${rowsForBudget(FREE_CREDIT_USD, averageCostUsd).toLocaleString("en-US")} rows`);
  console.log(`Saved ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

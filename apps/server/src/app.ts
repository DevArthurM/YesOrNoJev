import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";
import {
  API_KEY_HEADER,
  MAX_PARALLEL_JEVS,
  type AppConfig,
  type CreateDatasetRequest,
  type CreateJobResponse,
  type JobEvent,
  type KeyValidation,
  type StartRunRequest,
} from "@yesornojev/shared";
import type { ServerEnv } from "./env.js";
import type { Store } from "./lib/db.js";
import type { JobManager } from "./lib/jobs.js";
import { loadBenchmark, toPricingInfo } from "./lib/pricing.js";

export const MAX_ROWS_PER_DATASET = 100_000;
export const MAX_QUESTION_LENGTH = 500;

export interface AppDeps {
  env: ServerEnv;
  jobs: JobManager;
  store: Store;
  fetchImpl?: typeof fetch;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function resolveApiKey(c: Context, env: ServerEnv): string | undefined {
  const userKey = c.req.header(API_KEY_HEADER)?.trim();
  if (userKey) return userKey;
  return env.allowServerKey ? env.serverKey : undefined;
}

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");

function parseDataset(body: unknown): Parsed<CreateDatasetRequest> {
  const input = body as Partial<CreateDatasetRequest> | null;
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, error: "The dataset needs a name." };
  if (!isStringArray(input?.columns) || input.columns.length === 0) return { ok: false, error: "The dataset needs columns." };
  if (!isStringArray(input?.numericColumns)) return { ok: false, error: "`numericColumns` must be a list of column names." };
  if (!Array.isArray(input?.rows) || input.rows.length === 0) return { ok: false, error: "The dataset has no rows." };
  if (input.rows.length > MAX_ROWS_PER_DATASET) return { ok: false, error: `A dataset can have at most ${MAX_ROWS_PER_DATASET} rows.` };
  if (!input.rows.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))) {
    return { ok: false, error: "Each row must be an object of column -> value." };
  }
  return { ok: true, value: { name, columns: input.columns, numericColumns: input.numericColumns, rows: input.rows } };
}

function parseRun(body: unknown, rowCount: number): Parsed<Required<StartRunRequest>> {
  const input = body as Partial<StartRunRequest> | null;
  const question = typeof input?.question === "string" ? input.question.trim() : "";
  if (!question) return { ok: false, error: "Ask a question first." };
  if (question.length > MAX_QUESTION_LENGTH) return { ok: false, error: `Keep the question under ${MAX_QUESTION_LENGTH} characters.` };
  const indices = input?.indices ?? Array.from({ length: rowCount }, (_, i) => i);
  if (!Array.isArray(indices) || !indices.every((i) => Number.isInteger(i) && i >= 0 && i < rowCount)) {
    return { ok: false, error: "`indices` must be row numbers inside the dataset." };
  }
  if (indices.length === 0) return { ok: false, error: "There are no rows to analyze." };
  return { ok: true, value: { question, indices: [...new Set(indices)], concurrency: Number(input?.concurrency) || 1 } };
}

export function createApp({ env, jobs, store, fetchImpl = fetch }: AppDeps) {
  const app = new Hono().basePath("/api");

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/config", (c) =>
    c.json<AppConfig>({
      hasServerKey: Boolean(env.serverKey && env.allowServerKey),
      model: env.model,
      maxParallel: MAX_PARALLEL_JEVS,
    }),
  );

  app.get("/pricing", (c) => c.json(toPricingInfo(loadBenchmark())));

  app.post("/key/validate", async (c) => {
    const key = resolveApiKey(c, env);
    if (!key) return c.json<KeyValidation>({ valid: false, error: "No API key provided." }, 400);
    try {
      const res = await fetchImpl(`${env.apiBase}/v1/account`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 401 || res.status === 403) {
        return c.json<KeyValidation>({ valid: false, error: "That key was rejected by impossibl.com." }, 401);
      }
      if (!res.ok) return c.json<KeyValidation>({ valid: false, error: `impossibl.com answered ${res.status}.` }, 502);
      const account = (await res.json()) as { balance?: { usd?: number } };
      return c.json<KeyValidation>({ valid: true, balanceUsd: account.balance?.usd });
    } catch {
      return c.json<KeyValidation>({ valid: false, error: "Could not reach impossibl.com." }, 502);
    }
  });

  app.get("/datasets", (c) => c.json(store.listDatasets()));

  app.post("/datasets", bodyLimit({ maxSize: 64 * 1024 * 1024 }), async (c) => {
    const parsed = parseDataset(await c.req.json().catch(() => null));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    return c.json(store.createDataset(randomUUID(), parsed.value), 201);
  });

  app.get("/datasets/:id", (c) => {
    const dataset = store.getDataset(c.req.param("id"));
    return dataset ? c.json(dataset) : c.json({ error: "Dataset not found." }, 404);
  });

  app.patch("/datasets/:id", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) return c.json({ error: "The dataset needs a name." }, 400);
    return store.renameDataset(c.req.param("id"), name) ? c.json(store.getSummary(c.req.param("id"))) : c.json({ error: "Dataset not found." }, 404);
  });

  app.delete("/datasets/:id", (c) => {
    const id = c.req.param("id");
    const jobId = store.getSummary(id)?.run?.jobId;
    if (jobId) jobs.cancel(jobId);
    return store.deleteDataset(id) ? c.json({ ok: true }) : c.json({ error: "Dataset not found." }, 404);
  });

  app.post("/datasets/:id/runs", async (c) => {
    const id = c.req.param("id");
    const summary = store.getSummary(id);
    if (!summary) return c.json({ error: "Dataset not found." }, 404);
    if (summary.run?.jobId && jobs.get(summary.run.jobId)?.status === "running") {
      return c.json({ error: "The jevs are already working on this dataset." }, 409);
    }
    const apiKey = resolveApiKey(c, env);
    if (!apiKey) return c.json({ error: "Add your impossibl API key to run the JEVs." }, 401);
    const parsed = parseRun(await c.req.json().catch(() => null), summary.rowCount);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const { question, indices, concurrency } = parsed.value;
    const rows = store.getRows(id);
    const jobId = randomUUID();
    store.startRun(id, question, indices, jobId);
    const created = jobs.create({
      id: jobId,
      apiKey,
      question,
      concurrency,
      rows: indices.map((index) => ({ index, data: rows[index]! })),
      // The dataset may be deleted mid-run; its rows then no longer exist to save against.
      onResult: (result) => store.getSummary(id) && store.saveResult(id, result),
      onFinish: (status, error) => store.finishRun(id, status, error),
    });
    return c.json<CreateJobResponse>(created, 201);
  });

  app.get("/jobs/:id", (c) => {
    const job = jobs.get(c.req.param("id"));
    return job ? c.json(job) : c.json({ error: "Job not found." }, 404);
  });

  app.post("/jobs/:id/cancel", (c) =>
    jobs.cancel(c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "Job not found." }, 404),
  );

  app.get("/jobs/:id/events", (c) => {
    const jobId = c.req.param("id");
    if (!jobs.get(jobId)) return c.json({ error: "Job not found." }, 404);

    return streamSSE(c, async (stream) => {
      const queue: JobEvent[] = [];
      let wake: (() => void) | undefined;
      let finished = false;
      const unsubscribe = jobs.subscribe(jobId, (event) => {
        queue.push(event);
        if (event.type === "job:done") finished = true;
        wake?.();
      });
      stream.onAbort(() => {
        finished = true;
        unsubscribe?.();
        wake?.();
      });

      while (true) {
        while (queue.length > 0) {
          const event = queue.shift()!;
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        }
        if (finished || stream.aborted) break;
        await new Promise<void>((resolve) => (wake = resolve));
        wake = undefined;
      }
      unsubscribe?.();
    });
  });

  return app;
}

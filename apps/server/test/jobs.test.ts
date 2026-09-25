import { describe, expect, it } from "vitest";
import type { DatasetDetail, JobEvent } from "@yesornojev/shared";
import { createApp } from "../src/app.js";
import { readEnv } from "../src/env.js";
import { Store } from "../src/lib/db.js";
import { JevError, type AskJev } from "../src/lib/jev.js";
import { JobManager } from "../src/lib/jobs.js";

const rows = Array.from({ length: 25 }, (_, index) => ({ index, data: { id: String(index) } }));

function fakeJev(options: { delayMs?: number; failOn?: number; fatalOn?: number } = {}) {
  let active = 0;
  let peak = 0;
  const ask: AskJev = async (_key, _question, row, signal) => {
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, options.delayMs ?? 5);
        signal?.addEventListener("abort", () => (clearTimeout(timer), reject(signal.reason)), { once: true });
      });
      const id = Number(row.id);
      if (id === options.fatalOn) throw new JevError("Invalid key", 401, true, false);
      if (id === options.failOn) throw new Error("boom");
      return { verdict: id % 2 === 0 ? "yes" : "no", probability: id % 2 === 0 ? 0.9 : 0.1, inputTokens: 100, modelVersion: "jev-test" };
    } finally {
      active--;
    }
  };
  return { ask, peak: () => peak };
}

function collect(manager: JobManager, jobId: string) {
  return new Promise<JobEvent[]>((resolve) => {
    const events: JobEvent[] = [];
    manager.subscribe(jobId, (event) => {
      events.push(event);
      if (event.type === "job:done") resolve(events);
    });
  });
}

describe("JobManager", () => {
  it("answers every row and never exceeds the concurrency cap of 10", async () => {
    const jev = fakeJev();
    const manager = new JobManager({ askJev: jev.ask, pricePerInputToken: async () => 0.000001 });
    const { jobId, concurrency } = manager.create({ apiKey: "k", question: "q", rows, concurrency: 50 });
    expect(concurrency).toBe(10);
    const events = await collect(manager, jobId);
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "job:done", status: "done", progress: { total: 25, done: 25, yes: 13, no: 12, errors: 0 } });
    expect(jev.peak()).toBeLessThanOrEqual(10);
    if (done?.type === "job:done") expect(done.progress.costUsd).toBeCloseTo(25 * 100 * 0.000001);
  });

  it("turns a failing row into an error without stopping the job", async () => {
    const manager = new JobManager({ askJev: fakeJev({ failOn: 3 }).ask, pricePerInputToken: async () => 0 });
    const { jobId } = manager.create({ apiKey: "k", question: "q", rows, concurrency: 4 });
    const events = await collect(manager, jobId);
    const failed = events.find((e) => e.type === "row:done" && e.result.index === 3);
    expect(failed).toMatchObject({ result: { verdict: "error", error: "boom" } });
    expect(events.at(-1)).toMatchObject({ status: "done", progress: { done: 25, errors: 1 } });
  });

  it("stops the job on a fatal error", async () => {
    const manager = new JobManager({ askJev: fakeJev({ fatalOn: 0 }).ask, pricePerInputToken: async () => 0 });
    const { jobId } = manager.create({ apiKey: "k", question: "q", rows, concurrency: 1 });
    const events = await collect(manager, jobId);
    expect(events.at(-1)).toMatchObject({ type: "job:done", status: "failed", error: "Invalid key" });
  });

  it("can be cancelled mid-run", async () => {
    const manager = new JobManager({ askJev: fakeJev({ delayMs: 30 }).ask, pricePerInputToken: async () => 0 });
    const { jobId } = manager.create({ apiKey: "k", question: "q", rows, concurrency: 2 });
    const pending = collect(manager, jobId);
    setTimeout(() => manager.cancel(jobId), 45);
    const done = (await pending).at(-1);
    expect(done).toMatchObject({ status: "cancelled" });
    if (done?.type === "job:done") expect(done.progress.done).toBeLessThan(25);
  });
});

describe("HTTP API", () => {
  const env = { ...readEnv({}), serverKey: "server-key" };
  const records = [
    { name: "Ada", title: "VP of Sales" },
    { name: "Bob", title: "Intern" },
    { name: "Cleo", title: "CEO" },
    { name: "Dan", title: "SDR" },
  ];

  function setup(overrides: Partial<typeof env> = {}) {
    const store = new Store(":memory:");
    const jobs = new JobManager({ askJev: fakeJevByName().ask, pricePerInputToken: async () => 0.000001 });
    return { store, app: createApp({ env: { ...env, ...overrides }, jobs, store }) };
  }

  const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  async function readEvents(res: Response) {
    return (await res.text())
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as JobEvent);
  }

  it("stores a dataset, runs it, streams events and persists every result", async () => {
    const { app, store } = setup();
    const created = await app.request("/api/datasets", json({ name: "contacts.csv", columns: ["name", "title"], numericColumns: [], rows: records }));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const run = await app.request(`/api/datasets/${id}/runs`, json({ question: "Is this a decision maker?", concurrency: 3 }));
    expect(run.status).toBe(201);
    const { jobId } = (await run.json()) as { jobId: string };

    const events = await readEvents(await app.request(`/api/jobs/${jobId}/events`));
    expect(events.filter((e) => e.type === "row:done")).toHaveLength(4);
    expect(events.at(-1)).toMatchObject({ type: "job:done", status: "done" });

    const detail = (await (await app.request(`/api/datasets/${id}`)).json()) as DatasetDetail;
    expect(detail.rows).toEqual(records);
    expect(Object.keys(detail.results)).toHaveLength(4);
    expect(detail.run).toMatchObject({ question: "Is this a decision maker?", status: "done", progress: { done: 4, yes: 2, no: 2 } });
    expect(detail.run?.jobId).toBeUndefined();
    store.close();
  });

  it("re-asking the same question only re-runs the requested rows", async () => {
    const { app, store } = setup();
    const { id } = (await (await app.request("/api/datasets", json({ name: "l", columns: ["name", "title"], numericColumns: [], rows: records }))).json()) as { id: string };
    const first = (await (await app.request(`/api/datasets/${id}/runs`, json({ question: "q", concurrency: 2 }))).json()) as { jobId: string };
    await readEvents(await app.request(`/api/jobs/${first.jobId}/events`));

    const second = (await (await app.request(`/api/datasets/${id}/runs`, json({ question: "q", indices: [1], concurrency: 2 }))).json()) as { jobId: string; total: number };
    expect(second.total).toBe(1);
    await readEvents(await app.request(`/api/jobs/${second.jobId}/events`));
    expect(store.getResults(id)).toHaveLength(4);

    const third = (await (await app.request(`/api/datasets/${id}/runs`, json({ question: "a new question", indices: [0], concurrency: 2 }))).json()) as { jobId: string };
    await readEvents(await app.request(`/api/jobs/${third.jobId}/events`));
    expect(store.getResults(id).map((r) => r.index)).toEqual([0]);
    store.close();
  });

  it("renames and deletes datasets", async () => {
    const { app, store } = setup();
    const { id } = (await (await app.request("/api/datasets", json({ name: "a.csv", columns: ["name"], numericColumns: [], rows: [{ name: "x" }] }))).json()) as { id: string };
    const renamed = await app.request(`/api/datasets/${id}`, { method: "PATCH", body: JSON.stringify({ name: "b.csv" }) });
    expect(await renamed.json()).toMatchObject({ name: "b.csv", rowCount: 1 });
    expect((await app.request(`/api/datasets/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(await (await app.request("/api/datasets")).json()).toEqual([]);
    store.close();
  });

  it("rejects bad input and missing keys", async () => {
    const { app, store } = setup();
    expect((await app.request("/api/datasets", json({ name: "x", columns: [], numericColumns: [], rows: [] }))).status).toBe(400);
    const { id } = (await (await app.request("/api/datasets", json({ name: "a", columns: ["name"], numericColumns: [], rows: [{ name: "x" }] }))).json()) as { id: string };
    expect((await app.request(`/api/datasets/${id}/runs`, json({ question: " ", concurrency: 1 }))).status).toBe(400);
    expect((await app.request(`/api/datasets/${id}/runs`, json({ question: "q", indices: [5], concurrency: 1 }))).status).toBe(400);
    expect((await app.request("/api/datasets/nope/runs", json({ question: "q", concurrency: 1 }))).status).toBe(404);
    store.close();

    const noKey = setup({ serverKey: undefined });
    const other = (await (await noKey.app.request("/api/datasets", json({ name: "a", columns: ["name"], numericColumns: [], rows: [{ name: "x" }] }))).json()) as { id: string };
    expect((await noKey.app.request(`/api/datasets/${other.id}/runs`, json({ question: "q", concurrency: 1 }))).status).toBe(401);
    noKey.store.close();
  });

  it("reports pricing from the committed benchmark", async () => {
    const { app, store } = setup();
    const pricing = (await (await app.request("/api/pricing")).json()) as { rowsForFreeCredit: number; averageCostUsd: number };
    expect(pricing.rowsForFreeCredit).toBe(Math.floor(3 / pricing.averageCostUsd));
    store.close();
  });
});

/** Says yes to senior titles. */
function fakeJevByName() {
  const ask: AskJev = async (_key, _question, row) => {
    await new Promise((resolve) => setTimeout(resolve, 2));
    const yes = /VP|CEO/.test(row.title ?? "");
    return { verdict: yes ? "yes" : "no", probability: yes ? 0.9 : 0.1, inputTokens: 50, modelVersion: "jev-test" };
  };
  return { ask };
}

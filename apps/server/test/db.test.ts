import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Store } from "../src/lib/db.js";

const dir = mkdtempSync(join(tmpdir(), "yonj-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const dataset = { name: "contacts.csv", columns: ["name", "employees"], numericColumns: ["employees"], rows: [{ name: "Ada", employees: "120" }, { name: "Bob", employees: "8" }] };

describe("Store", () => {
  it("creates the database file (and folder) on first start and keeps data across restarts", () => {
    const path = join(dir, "nested", "yesornojev.sqlite");
    const first = new Store(path);
    first.createDataset("d1", dataset);
    first.startRun("d1", "Is this a decision maker?", [0, 1], "job-1");
    first.saveResult("d1", { index: 0, verdict: "yes", probability: 0.9, costUsd: 0.00002, inputTokens: 400 });
    first.close();

    const second = new Store(path);
    second.markInterruptedRuns();
    const detail = second.getDataset("d1");
    expect(detail?.rows).toEqual(dataset.rows);
    expect(detail?.results[0]).toEqual({ index: 0, verdict: "yes", probability: 0.9, costUsd: 0.00002, inputTokens: 400 });
    // The server stopped mid-run, so the run can't be live any more.
    expect(detail?.run).toMatchObject({ question: "Is this a decision maker?", status: "cancelled", progress: { done: 1, yes: 1, total: 2 } });
    expect(detail?.run?.jobId).toBeUndefined();
    second.close();
  });

  it("deleting a dataset removes its rows and results", () => {
    const store = new Store(":memory:");
    store.createDataset("d1", dataset);
    store.startRun("d1", "q", [0], "job");
    store.saveResult("d1", { index: 0, verdict: "error", error: "boom" });
    expect(store.deleteDataset("d1")).toBe(true);
    expect(store.getRows("d1")).toEqual([]);
    expect(store.getResults("d1")).toEqual([]);
    store.close();
  });
});

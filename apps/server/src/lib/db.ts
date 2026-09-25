import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CreateDatasetRequest,
  DatasetDetail,
  DatasetRunSummary,
  DatasetSummary,
  JobProgress,
  JobStatus,
  RowData,
  RowResult,
  Verdict,
} from "@yesornojev/shared";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS datasets (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    columns         TEXT NOT NULL,
    numeric_columns TEXT NOT NULL,
    row_count       INTEGER NOT NULL,
    created_at      INTEGER NOT NULL,
    run_question    TEXT,
    run_status      TEXT,
    run_error       TEXT,
    run_job_id      TEXT
  );
  CREATE TABLE IF NOT EXISTS rows (
    dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    idx        INTEGER NOT NULL,
    data       TEXT NOT NULL,
    PRIMARY KEY (dataset_id, idx)
  );
  CREATE TABLE IF NOT EXISTS results (
    dataset_id   TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    idx          INTEGER NOT NULL,
    verdict      TEXT NOT NULL,
    probability  REAL,
    cost_usd     REAL,
    input_tokens INTEGER,
    error        TEXT,
    PRIMARY KEY (dataset_id, idx)
  );
`;

interface DatasetRow {
  id: string;
  name: string;
  columns: string;
  numeric_columns: string;
  row_count: number;
  created_at: number;
  run_question: string | null;
  run_status: string | null;
  run_error: string | null;
  run_job_id: string | null;
}

interface ResultRow {
  idx: number;
  verdict: string;
  probability: number | null;
  cost_usd: number | null;
  input_tokens: number | null;
  error: string | null;
}

const toResult = (r: ResultRow): RowResult => ({
  index: r.idx,
  verdict: r.verdict as Verdict,
  ...(r.probability !== null && { probability: r.probability }),
  ...(r.cost_usd !== null && { costUsd: r.cost_usd }),
  ...(r.input_tokens !== null && { inputTokens: r.input_tokens }),
  ...(r.error !== null && { error: r.error }),
});

/**
 * SQLite storage for datasets, their rows and the latest run's results.
 * The file is created on first start and reused afterwards (CREATE TABLE IF NOT EXISTS).
 */
export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Runs that were live when the server stopped can't resume; mark them as stopped. */
  markInterruptedRuns() {
    this.db
      .prepare("UPDATE datasets SET run_status = 'cancelled', run_job_id = NULL WHERE run_status IN ('running', 'starting')")
      .run();
  }

  createDataset(id: string, input: CreateDatasetRequest): DatasetSummary {
    const createdAt = Date.now();
    this.transaction(() => {
      this.db
        .prepare("INSERT INTO datasets (id, name, columns, numeric_columns, row_count, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, input.name, JSON.stringify(input.columns), JSON.stringify(input.numericColumns), input.rows.length, createdAt);
      const insert = this.db.prepare("INSERT INTO rows (dataset_id, idx, data) VALUES (?, ?, ?)");
      input.rows.forEach((row, i) => insert.run(id, i, JSON.stringify(row)));
    });
    return this.getSummary(id)!;
  }

  listDatasets(): DatasetSummary[] {
    const rows = this.db.prepare("SELECT * FROM datasets ORDER BY created_at").all() as unknown as DatasetRow[];
    return rows.map((row) => this.toSummary(row));
  }

  getSummary(id: string): DatasetSummary | undefined {
    const row = this.db.prepare("SELECT * FROM datasets WHERE id = ?").get(id) as unknown as DatasetRow | undefined;
    return row && this.toSummary(row);
  }

  getDataset(id: string): DatasetDetail | undefined {
    const summary = this.getSummary(id);
    if (!summary) return undefined;
    const results = Object.fromEntries(this.getResults(id).map((r) => [r.index, r]));
    return { ...summary, rows: this.getRows(id), results };
  }

  getRows(id: string): RowData[] {
    const rows = this.db.prepare("SELECT data FROM rows WHERE dataset_id = ? ORDER BY idx").all(id) as unknown as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as RowData);
  }

  getResults(id: string): RowResult[] {
    const rows = this.db.prepare("SELECT * FROM results WHERE dataset_id = ? ORDER BY idx").all(id) as unknown as ResultRow[];
    return rows.map(toResult);
  }

  renameDataset(id: string, name: string): boolean {
    return Number(this.db.prepare("UPDATE datasets SET name = ? WHERE id = ?").run(name, id).changes) > 0;
  }

  deleteDataset(id: string): boolean {
    return Number(this.db.prepare("DELETE FROM datasets WHERE id = ?").run(id).changes) > 0;
  }

  /**
   * Starts a run. A new question wipes the previous results; the same question only
   * clears the rows about to be re-asked.
   */
  startRun(id: string, question: string, indices: number[], jobId: string) {
    this.transaction(() => {
      const current = this.db.prepare("SELECT run_question FROM datasets WHERE id = ?").get(id) as { run_question: string | null } | undefined;
      if (current?.run_question !== question) {
        this.db.prepare("DELETE FROM results WHERE dataset_id = ?").run(id);
      } else {
        const remove = this.db.prepare("DELETE FROM results WHERE dataset_id = ? AND idx = ?");
        for (const i of indices) remove.run(id, i);
      }
      this.db
        .prepare("UPDATE datasets SET run_question = ?, run_status = 'running', run_error = NULL, run_job_id = ? WHERE id = ?")
        .run(question, jobId, id);
    });
  }

  saveResult(id: string, result: RowResult) {
    this.db
      .prepare(
        `INSERT INTO results (dataset_id, idx, verdict, probability, cost_usd, input_tokens, error)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (dataset_id, idx) DO UPDATE SET
           verdict = excluded.verdict, probability = excluded.probability, cost_usd = excluded.cost_usd,
           input_tokens = excluded.input_tokens, error = excluded.error`,
      )
      .run(id, result.index, result.verdict, result.probability ?? null, result.costUsd ?? null, result.inputTokens ?? null, result.error ?? null);
  }

  finishRun(id: string, status: JobStatus, error?: string) {
    this.db.prepare("UPDATE datasets SET run_status = ?, run_error = ?, run_job_id = NULL WHERE id = ?").run(status, error ?? null, id);
  }

  private progress(id: string, total: number): JobProgress {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS done,
                COALESCE(SUM(verdict = 'yes'), 0) AS yes,
                COALESCE(SUM(verdict = 'no'), 0) AS no,
                COALESCE(SUM(verdict = 'error'), 0) AS errors,
                COALESCE(SUM(cost_usd), 0) AS cost
         FROM results WHERE dataset_id = ?`,
      )
      .get(id) as { done: number; yes: number; no: number; errors: number; cost: number };
    return { total, done: row.done, yes: row.yes, no: row.no, errors: row.errors, costUsd: row.cost };
  }

  private toSummary(row: DatasetRow): DatasetSummary {
    const run: DatasetRunSummary | undefined = row.run_question
      ? {
          question: row.run_question,
          status: (row.run_status ?? "done") as JobStatus,
          progress: this.progress(row.id, row.row_count),
          ...(row.run_error && { error: row.run_error }),
          ...(row.run_job_id && { jobId: row.run_job_id }),
        }
      : undefined;
    return {
      id: row.id,
      name: row.name,
      columns: JSON.parse(row.columns) as string[],
      numericColumns: JSON.parse(row.numeric_columns) as string[],
      rowCount: row.row_count,
      createdAt: row.created_at,
      ...(run && { run }),
    };
  }
}

/** Hard ceiling for concurrent JEV calls per job. Enforced on client and server. */
export const MAX_PARALLEL_JEVS = 10;
export const DEFAULT_PARALLEL_JEVS = 5;

/** Free credit a new impossibl.com account gets, used on the welcome screen. */
export const FREE_CREDIT_USD = 3;

export const IMPOSSIBL_SIGNUP_URL = "https://impossibl.com";

/** Header the web app uses to forward a user's own impossibl API key to our server. */
export const API_KEY_HEADER = "x-impossibl-key";

export type Verdict = "yes" | "no" | "error";

/** A single CSV row as a plain JSON object: column name -> cell value. */
export type RowData = Record<string, string>;

export interface JobRowInput {
  /** Index of the row inside its dataset, echoed back in events. */
  index: number;
  data: RowData;
}

export interface CreateDatasetRequest {
  name: string;
  columns: string[];
  numericColumns: string[];
  rows: RowData[];
}

export interface StartRunRequest {
  question: string;
  /** Dataset row indices to ask about. Omit to ask about every row. */
  indices?: number[];
  concurrency: number;
}

export interface CreateJobResponse {
  jobId: string;
  total: number;
  concurrency: number;
}

export interface RowResult {
  index: number;
  verdict: Verdict;
  /** Probability that the statement is true (0..1). Absent on errors. */
  probability?: number;
  costUsd?: number;
  inputTokens?: number;
  error?: string;
}

export interface JobProgress {
  total: number;
  done: number;
  yes: number;
  no: number;
  errors: number;
  costUsd: number;
}

export type JobStatus = "running" | "done" | "cancelled" | "failed";

export type JobEvent =
  | { type: "row:started"; index: number }
  | { type: "row:done"; result: RowResult }
  | { type: "job:progress"; progress: JobProgress }
  | { type: "job:done"; status: JobStatus; progress: JobProgress; error?: string };

/** The latest run of a dataset. Results are stored per row in the database. */
export interface DatasetRunSummary {
  question: string;
  status: JobStatus;
  progress: JobProgress;
  error?: string;
  /** Present while the run is live; subscribe to its events to follow it. */
  jobId?: string;
}

export interface DatasetSummary {
  id: string;
  name: string;
  columns: string[];
  numericColumns: string[];
  rowCount: number;
  createdAt: number;
  run?: DatasetRunSummary;
}

export interface DatasetDetail extends DatasetSummary {
  rows: RowData[];
  results: Record<number, RowResult>;
}

export interface PricingInfo {
  model: string;
  averageCostUsd: number;
  sampleSize: number;
  measuredAt: string;
  rowsForFreeCredit: number;
  freeCreditUsd: number;
}

export interface AppConfig {
  hasServerKey: boolean;
  model: string;
  maxParallel: number;
}

export interface KeyValidation {
  valid: boolean;
  balanceUsd?: number;
  error?: string;
}

/** Turns a free-form question into a safe CSV column name, e.g. "Is this a hot lead?" -> "is_this_a_hot_lead". */
export function slugifyQuestion(question: string, maxLength = 40): string {
  const slug = question
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength)
    .replace(/_+$/g, "");
  return slug || "jev_verdict";
}

export function clampParallel(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PARALLEL_JEVS;
  return Math.min(MAX_PARALLEL_JEVS, Math.max(1, Math.round(value)));
}

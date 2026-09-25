import { randomUUID } from "node:crypto";
import {
  clampParallel,
  type JobEvent,
  type JobProgress,
  type JobRowInput,
  type JobStatus,
  type RowResult,
} from "@yesornojev/shared";
import { JevError, type AskJev } from "./jev.js";

type Listener = (event: JobEvent) => void;

interface Job {
  id: string;
  status: JobStatus;
  progress: JobProgress;
  /** Every event emitted so far, replayed to late subscribers. */
  history: JobEvent[];
  listeners: Set<Listener>;
  controller: AbortController;
  finishedAt?: number;
}

export interface CreateJobInput {
  /** Optional id, so callers can record the job before it starts. */
  id?: string;
  apiKey: string;
  question: string;
  rows: JobRowInput[];
  concurrency: number;
  /** Called as each row finishes (e.g. to persist it). */
  onResult?: (result: RowResult) => void;
  /** Called once when the job ends. */
  onFinish?: (status: JobStatus, error?: string) => void;
}

export interface JobManagerOptions {
  askJev: AskJev;
  /** USD per input token, used for the live cost estimate. */
  pricePerInputToken: () => Promise<number>;
  /** How long finished jobs stay in memory for replay. */
  retentionMs?: number;
}

/**
 * Runs JEV jobs in memory. Each job walks its rows through a bounded worker pool
 * (at most MAX_PARALLEL_JEVS concurrent calls) and emits events as rows finish.
 */
export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private readonly retentionMs: number;

  constructor(private readonly options: JobManagerOptions) {
    this.retentionMs = options.retentionMs ?? 30 * 60_000;
  }

  create(input: CreateJobInput) {
    this.sweep();
    const concurrency = clampParallel(input.concurrency);
    const job: Job = {
      id: input.id ?? randomUUID(),
      status: "running",
      progress: { total: input.rows.length, done: 0, yes: 0, no: 0, errors: 0, costUsd: 0 },
      history: [],
      listeners: new Set(),
      controller: new AbortController(),
    };
    this.jobs.set(job.id, job);
    void this.run(job, input, concurrency);
    return { jobId: job.id, total: input.rows.length, concurrency };
  }

  /** Subscribes to a job. Past events are replayed synchronously. Returns an unsubscribe function. */
  subscribe(jobId: string, listener: Listener): (() => void) | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    for (const event of job.history) listener(event);
    if (job.status !== "running") return () => {};
    job.listeners.add(listener);
    return () => job.listeners.delete(listener);
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status === "running") job.controller.abort(new Error("cancelled"));
    return true;
  }

  get(jobId: string) {
    const job = this.jobs.get(jobId);
    return job && { id: job.id, status: job.status, progress: { ...job.progress } };
  }

  private emit(job: Job, event: JobEvent) {
    job.history.push(event);
    for (const listener of job.listeners) listener(event);
  }

  private async run(job: Job, input: CreateJobInput, concurrency: number) {
    const { apiKey, question, rows, onResult, onFinish } = input;
    const pricePerToken = await this.options.pricePerInputToken();
    const { signal } = job.controller;
    let cursor = 0;
    let fatal: JevError | undefined;

    const record = (result: RowResult) => {
      const p = job.progress;
      p.done += 1;
      if (result.verdict === "yes") p.yes += 1;
      else if (result.verdict === "no") p.no += 1;
      else p.errors += 1;
      p.costUsd += result.costUsd ?? 0;
      onResult?.(result);
      this.emit(job, { type: "row:done", result });
      this.emit(job, { type: "job:progress", progress: { ...p } });
    };

    const worker = async () => {
      while (!signal.aborted) {
        const row = rows[cursor++];
        if (!row) return;
        this.emit(job, { type: "row:started", index: row.index });
        try {
          const answer = await this.options.askJev(apiKey, question, row.data, signal);
          record({
            index: row.index,
            verdict: answer.verdict,
            probability: answer.probability,
            inputTokens: answer.inputTokens,
            costUsd: answer.inputTokens * pricePerToken,
          });
        } catch (error) {
          if (signal.aborted && !fatal) return;
          const message = error instanceof Error ? error.message : String(error);
          record({ index: row.index, verdict: "error", error: message });
          if (error instanceof JevError && error.fatal && !fatal) {
            fatal = error;
            job.controller.abort(error);
          }
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));

    job.status = fatal ? "failed" : signal.aborted ? "cancelled" : "done";
    job.finishedAt = Date.now();
    onFinish?.(job.status, fatal?.message);
    this.emit(job, { type: "job:done", status: job.status, progress: { ...job.progress }, error: fatal?.message });
    job.listeners.clear();
  }

  private sweep() {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (job.finishedAt && now - job.finishedAt > this.retentionMs) this.jobs.delete(id);
    }
  }
}

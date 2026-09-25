import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DatasetDetail, DatasetSummary, JobProgress, JobStatus, RowData, RowResult } from "@yesornojev/shared";
import { api, subscribeToJob } from "../lib/api";
import { userApiKey, useSettings } from "./settings";
import { toast } from "./toasts";

export type RunStatus = JobStatus | "starting";

export interface DatasetRun {
  question: string;
  results: Record<number, RowResult>;
  status: RunStatus;
  progress: JobProgress;
  jobId?: string;
  error?: string;
}

/**
 * A dataset as the web app sees it. Datasets live in the server's SQLite database;
 * `rows` (and the run's per-row results) are fetched when the dataset is first opened.
 */
export interface Dataset {
  id: string;
  name: string;
  columns: string[];
  numericColumns: string[];
  rowCount: number;
  createdAt: number;
  rows?: RowData[];
  run?: DatasetRun;
}

interface DatasetsState {
  datasets: Dataset[];
  loaded: boolean;
  selectedId?: string;
  /** Row indices a JEV is currently looking at, per dataset. */
  thinking: Record<string, Set<number>>;
  load: () => Promise<void>;
  open: (id: string) => Promise<void>;
  addDataset: (input: { name: string; columns: string[]; numericColumns: string[]; rows: RowData[] }) => Promise<void>;
  removeDataset: (id: string) => Promise<void>;
  renameDataset: (id: string, name: string) => Promise<void>;
  select: (id: string) => void;
  run: (datasetId: string, question: string, indices: number[]) => Promise<void>;
  cancel: (datasetId: string) => Promise<void>;
}

const emptyProgress = (total: number): JobProgress => ({ total, done: 0, yes: 0, no: 0, errors: 0, costUsd: 0 });

/** Recomputes counters from the results we hold, so re-runs on a subset keep totals right. */
export function summarize(results: Record<number, RowResult>, total: number): JobProgress {
  const progress = emptyProgress(total);
  for (const result of Object.values(results)) {
    progress.done++;
    if (result.verdict === "yes") progress.yes++;
    else if (result.verdict === "no") progress.no++;
    else progress.errors++;
    progress.costUsd += result.costUsd ?? 0;
  }
  return progress;
}

function fromSummary(summary: DatasetSummary, previous?: Dataset): Dataset {
  const { run, ...rest } = summary;
  return {
    ...rest,
    rows: previous?.rows,
    run: run && { ...run, results: previous?.run?.question === run.question ? previous.run.results : {} },
  };
}

function fromDetail(detail: DatasetDetail): Dataset {
  const { rows, results, run, ...rest } = detail;
  return { ...rest, rows, run: run && { ...run, results } };
}

const unsubscribers = new Map<string, () => void>();

/** When each row's verdict arrived (`datasetId:index` -> ms), so only fresh answers animate. */
export const arrivals = new Map<string, number>();
export const isFresh = (datasetId: string, index: number) => Date.now() - (arrivals.get(`${datasetId}:${index}`) ?? 0) < 900;

export const useDatasets = create<DatasetsState>()(
  persist(
    (set, get) => {
      const patch = (datasetId: string, update: (dataset: Dataset) => Dataset) =>
        set((state) => ({ datasets: state.datasets.map((d) => (d.id === datasetId ? update(d) : d)) }));

      const patchRun = (datasetId: string, update: (run: DatasetRun, dataset: Dataset) => DatasetRun) =>
        patch(datasetId, (d) => (d.run ? { ...d, run: update(d.run, d) } : d));

      const setThinking = (datasetId: string, update: (current: Set<number>) => Set<number>) =>
        set((state) => ({ thinking: { ...state.thinking, [datasetId]: update(state.thinking[datasetId] ?? new Set()) } }));

      /** Follows a live job. Past events are replayed by the server, so this also resumes after a reload. */
      const follow = (datasetId: string, jobId: string) => {
        unsubscribers.get(datasetId)?.();
        const unsubscribe = subscribeToJob(
          jobId,
          (event) => {
            if (event.type === "row:started") {
              setThinking(datasetId, (s) => new Set(s).add(event.index));
            } else if (event.type === "row:done") {
              arrivals.set(`${datasetId}:${event.result.index}`, Date.now());
              setThinking(datasetId, (s) => {
                const next = new Set(s);
                next.delete(event.result.index);
                return next;
              });
              patchRun(datasetId, (run, d) => {
                const results = { ...run.results, [event.result.index]: event.result };
                return { ...run, results, progress: summarize(results, d.rowCount) };
              });
            } else if (event.type === "job:done") {
              unsubscribers.delete(datasetId);
              setThinking(datasetId, () => new Set());
              patchRun(datasetId, (run) => ({ ...run, status: event.status, error: event.error, jobId: undefined }));
            }
          },
          () => {
            unsubscribers.delete(datasetId);
            setThinking(datasetId, () => new Set());
            // The server keeps the results; reload them instead of guessing.
            void get().open(datasetId);
          },
        );
        unsubscribers.set(datasetId, unsubscribe);
      };

      return {
        datasets: [],
        loaded: false,
        thinking: {},

        load: async () => {
          try {
            const summaries = await api.listDatasets();
            set((state) => {
              const previous = new Map(state.datasets.map((d) => [d.id, d]));
              const datasets = summaries.map((s) => fromSummary(s, previous.get(s.id)));
              const selectedId = datasets.some((d) => d.id === state.selectedId) ? state.selectedId : datasets[0]?.id;
              return { datasets, selectedId, loaded: true };
            });
            const selectedId = get().selectedId;
            if (selectedId) await get().open(selectedId);
          } catch {
            set({ loaded: true });
            toast("Could not load your datasets from the server.", "error");
          }
        },

        open: async (id) => {
          try {
            const dataset = fromDetail(await api.getDataset(id));
            patch(id, () => dataset);
            if (dataset.run?.jobId && !unsubscribers.has(id)) follow(id, dataset.run.jobId);
          } catch {
            toast("Could not open this dataset.", "error");
          }
        },

        addDataset: async (input) => {
          const summary = await api.createDataset(input);
          set((state) => ({ datasets: [...state.datasets, { ...fromSummary(summary), rows: input.rows }], selectedId: summary.id }));
        },

        removeDataset: async (id) => {
          unsubscribers.get(id)?.();
          unsubscribers.delete(id);
          await api.deleteDataset(id).catch(() => toast("Could not remove this dataset.", "error"));
          set((state) => {
            const datasets = state.datasets.filter((d) => d.id !== id);
            const selectedId = state.selectedId === id ? datasets[0]?.id : state.selectedId;
            return { datasets, selectedId };
          });
          const selectedId = get().selectedId;
          if (selectedId && !get().datasets.find((d) => d.id === selectedId)?.rows) void get().open(selectedId);
        },

        renameDataset: async (id, name) => {
          const trimmed = name.trim();
          const current = get().datasets.find((d) => d.id === id);
          if (!trimmed || trimmed === current?.name) return;
          patch(id, (d) => ({ ...d, name: trimmed }));
          await api.renameDataset(id, trimmed).catch(() => toast("Could not rename this dataset.", "error"));
        },

        select: (id) => {
          set({ selectedId: id });
          if (!get().datasets.find((d) => d.id === id)?.rows) void get().open(id);
        },

        run: async (datasetId, question, indices) => {
          const dataset = get().datasets.find((d) => d.id === datasetId);
          if (!dataset || indices.length === 0) return;
          const sameQuestion = dataset.run?.question === question;
          const results = sameQuestion ? { ...dataset.run!.results } : {};
          for (const i of indices) delete results[i];
          patch(datasetId, (d) => ({ ...d, run: { question, results, status: "starting", progress: summarize(results, d.rowCount) } }));

          try {
            const everyRow = indices.length === dataset.rowCount;
            const { jobId } = await api.startRun(
              datasetId,
              { question, concurrency: useSettings.getState().parallel, ...(!everyRow && { indices }) },
              userApiKey(),
            );
            patchRun(datasetId, (run) => ({ ...run, jobId, status: "running" }));
            follow(datasetId, jobId);
          } catch (error) {
            patchRun(datasetId, (run) => ({ ...run, status: "failed", error: (error as Error).message }));
          }
        },

        cancel: async (datasetId) => {
          const jobId = get().datasets.find((d) => d.id === datasetId)?.run?.jobId;
          if (jobId) await api.cancelJob(jobId).catch(() => undefined);
        },
      };
    },
    // Only the selection is remembered locally; the data itself lives on the server.
    { name: "yonj-selection", partialize: (state) => ({ selectedId: state.selectedId }) },
  ),
);

export const useSelectedDataset = () =>
  useDatasets((state) => state.datasets.find((d) => d.id === state.selectedId));

export const isRunActive = (run?: DatasetRun) => run?.status === "running" || run?.status === "starting";

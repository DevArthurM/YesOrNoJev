import {
  API_KEY_HEADER,
  type AppConfig,
  type CreateDatasetRequest,
  type CreateJobResponse,
  type DatasetDetail,
  type DatasetSummary,
  type JobEvent,
  type KeyValidation,
  type PricingInfo,
  type StartRunRequest,
} from "@yesornojev/shared";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, apiKey?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (apiKey) headers.set(API_KEY_HEADER, apiKey);
  const res = await fetch(`/api${path}`, { ...init, headers });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  return body;
}

export const api = {
  config: () => request<AppConfig>("/config"),
  pricing: () => request<PricingInfo>("/pricing"),
  validateKey: (apiKey?: string) => request<KeyValidation>("/key/validate", { method: "POST" }, apiKey),
  listDatasets: () => request<DatasetSummary[]>("/datasets"),
  getDataset: (id: string) => request<DatasetDetail>(`/datasets/${id}`),
  createDataset: (body: CreateDatasetRequest) => request<DatasetSummary>("/datasets", { method: "POST", body: JSON.stringify(body) }),
  renameDataset: (id: string, name: string) =>
    request<DatasetSummary>(`/datasets/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteDataset: (id: string) => request<{ ok: boolean }>(`/datasets/${id}`, { method: "DELETE" }),
  startRun: (id: string, body: StartRunRequest, apiKey?: string) =>
    request<CreateJobResponse>(`/datasets/${id}/runs`, { method: "POST", body: JSON.stringify(body) }, apiKey),
  cancelJob: (jobId: string) => request<{ ok: boolean }>(`/jobs/${jobId}/cancel`, { method: "POST" }),
};

const EVENT_TYPES: JobEvent["type"][] = ["row:started", "row:done", "job:progress", "job:done"];

/** Streams job events over SSE. Returns a function that closes the stream. */
export function subscribeToJob(jobId: string, onEvent: (event: JobEvent) => void, onError: () => void) {
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  let finished = false;
  const handle = (message: MessageEvent<string>) => {
    const event = JSON.parse(message.data) as JobEvent;
    if (event.type === "job:done") {
      finished = true;
      source.close();
    }
    onEvent(event);
  };
  for (const type of EVENT_TYPES) source.addEventListener(type, handle);
  source.onerror = () => {
    if (finished) return;
    source.close();
    onError();
  };
  return () => source.close();
}

import type { RowData, Verdict } from "@yesornojev/shared";

/**
 * Client for impossibl's System One endpoint (`POST /v1/systemone`), which serves the
 * `typesafe-ai/jev` evaluation model. JEV never generates text: it answers typed
 * questions about a `state`. We ask one `noul` (yes/no) question per CSV row and get
 * back the probability that the statement is true.
 */

export const QUESTION_ID = "verdict";

/** Probability at or above which an answer counts as "yes". */
export const YES_THRESHOLD = 0.5;

export interface SystemOneRequest {
  model: string;
  state: RowData;
  questions: Record<
    string,
    { type: "noul"; instructions: string; criteria: { true: string; false: string } }
  >;
}

export interface SystemOneResponse {
  model: string;
  answers: Record<string, { type: string; noul?: number } | undefined>;
  usage: { input_tokens: number; output_tokens: number };
  request_id?: string;
}

export interface JevAnswer {
  verdict: Exclude<Verdict, "error">;
  probability: number;
  inputTokens: number;
  modelVersion: string;
}

export class JevError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    /** Fatal errors (bad key, no credits) stop the whole job instead of one row. */
    readonly fatal: boolean,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "JevError";
  }
}

export function buildInstructions(question: string): string {
  const statement = question.trim();
  return [
    "Is the following statement true for this data?",
    `Statement: ${statement}`,
    "The data is a single record from a CSV file; each key is a column name.",
    "Answer true only if the data supports the statement, false otherwise.",
  ].join("\n");
}

export function buildSystemOneRequest(model: string, question: string, row: RowData): SystemOneRequest {
  return {
    model,
    state: row,
    questions: {
      [QUESTION_ID]: {
        type: "noul",
        instructions: buildInstructions(question),
        criteria: {
          true: "Yes: the statement is true for this data.",
          false: "No: the statement is false for this data, or the data does not support it.",
        },
      },
    },
  };
}

export function parseSystemOneResponse(body: unknown): JevAnswer {
  const response = body as Partial<SystemOneResponse> | null;
  const answer = response?.answers?.[QUESTION_ID];
  const probability = answer?.noul;
  if (typeof probability !== "number" || Number.isNaN(probability)) {
    throw new JevError(`Unexpected JEV response: ${JSON.stringify(body).slice(0, 200)}`, undefined, false, false);
  }
  return {
    verdict: probability >= YES_THRESHOLD ? "yes" : "no",
    probability,
    inputTokens: response?.usage?.input_tokens ?? 0,
    modelVersion: response?.model ?? "unknown",
  };
}

function classifyHttpError(status: number, message: string): JevError {
  if (status === 401 || status === 403) return new JevError(`Invalid impossibl API key (${message})`, status, true, false);
  if (status === 402) return new JevError("Your impossibl balance is empty. Top up at impossibl.com.", status, true, false);
  if (status === 429 || status === 408 || status >= 500) return new JevError(message, status, false, true);
  return new JevError(message, status, false, false);
}

export interface JevClientOptions {
  apiBase: string;
  model: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
}

export type AskJev = (apiKey: string, question: string, row: RowData, signal?: AbortSignal) => Promise<JevAnswer>;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });

export function createJevClient(options: JevClientOptions): AskJev {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 600;
  const timeoutMs = options.timeoutMs ?? 30_000;

  const attempt = async (apiKey: string, question: string, row: RowData, signal?: AbortSignal) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await fetchImpl(`${options.apiBase}/v1/systemone`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(buildSystemOneRequest(options.model, question, row)),
        signal: combined,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new JevError(`Network error: ${(error as Error).message}`, undefined, false, true);
    }
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    if (!res.ok) {
      const message = (body as { error?: { message?: string } } | undefined)?.error?.message ?? (text.slice(0, 200) || res.statusText);
      throw classifyHttpError(res.status, message);
    }
    return parseSystemOneResponse(body);
  };

  return async (apiKey, question, row, signal) => {
    for (let tries = 0; ; tries++) {
      try {
        return await attempt(apiKey, question, row, signal);
      } catch (error) {
        const retryable = error instanceof JevError && error.retryable;
        if (!retryable || tries >= maxRetries || signal?.aborted) throw error;
        await sleep(baseDelayMs * 2 ** tries * (0.75 + Math.random() * 0.5), signal);
      }
    }
  };
}

import { describe, expect, it, vi } from "vitest";
import { buildSystemOneRequest, createJevClient, JevError, parseSystemOneResponse } from "../src/lib/jev.js";

const row = { name: "Ada", title: "VP of Sales", budget: "Approved" };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("buildSystemOneRequest", () => {
  it("sends the row as state and one noul question with the user's statement", () => {
    const request = buildSystemOneRequest("typesafe-ai/jev", "  Is this a hot lead?  ", row);
    expect(request.model).toBe("typesafe-ai/jev");
    expect(request.state).toEqual(row);
    const question = request.questions.verdict!;
    expect(question.type).toBe("noul");
    expect(question.instructions).toContain("Is the following statement true for this data?");
    expect(question.instructions).toContain("Statement: Is this a hot lead?");
    expect(Object.keys(question.criteria)).toEqual(["true", "false"]);
  });
});

describe("parseSystemOneResponse", () => {
  it("maps probabilities to yes/no around the 0.5 threshold", () => {
    const make = (noul: number) => ({ model: "jev-1", answers: { verdict: { type: "noul", noul } }, usage: { input_tokens: 42, output_tokens: 3 } });
    expect(parseSystemOneResponse(make(0.91))).toMatchObject({ verdict: "yes", probability: 0.91, inputTokens: 42 });
    expect(parseSystemOneResponse(make(0.5)).verdict).toBe("yes");
    expect(parseSystemOneResponse(make(0.12)).verdict).toBe("no");
  });

  it("throws on malformed answers", () => {
    expect(() => parseSystemOneResponse({ answers: {} })).toThrow(JevError);
    expect(() => parseSystemOneResponse(null)).toThrow(JevError);
  });
});

describe("createJevClient", () => {
  const ok = { model: "jev-1", answers: { verdict: { type: "noul", noul: 0.8 } }, usage: { input_tokens: 10, output_tokens: 1 } };

  it("authenticates with a bearer key against /v1/systemone", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, ok));
    const ask = createJevClient({ apiBase: "https://api.test", model: "m", fetchImpl });
    await expect(ask("secret", "q", row)).resolves.toMatchObject({ verdict: "yes" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/v1/systemone");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret");
  });

  it("retries transient failures then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: "slow down" } }))
      .mockResolvedValueOnce(jsonResponse(502, { error: { message: "upstream" } }))
      .mockResolvedValueOnce(jsonResponse(200, ok));
    const ask = createJevClient({ apiBase: "https://api.test", model: "m", fetchImpl, baseDelayMs: 1 });
    await expect(ask("k", "q", row)).resolves.toMatchObject({ verdict: "yes" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("marks auth and billing errors as fatal without retrying", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(402, { error: { message: "Insufficient credits" } }));
    const ask = createJevClient({ apiBase: "https://api.test", model: "m", fetchImpl, baseDelayMs: 1 });
    const error = await ask("k", "q", row).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).fatal).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

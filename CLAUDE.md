# CLAUDE.md — YesOrNoJev

**YesOrNoJev** is a small web app: the user uploads CSV files, asks one yes/no question about the data (e.g. *"Is this a hot lead?"*), and watches impossibl **JEVs** answer **yes** or **no** for every row, live.

This file is the base guide for working on the project: scope, rules, architecture and quality bar. When something is ambiguous, pick the simplest option that fits the intent here, and record user-facing decisions in the README's "Design decisions and limitations" section.

---

## 0. Rules

1. **Everything is in English.** Code, identifiers, file names, comments, commit messages, UI copy, logs, errors and docs.
2. **Never commit or log secrets.** The API key lives in `.env` as `IMPOSSIBL_API_KEY` (git-ignored; `.env.example` stays empty). Never print it, never ship it in the browser bundle, never hardcode it.
3. **Never invent the impossibl API contract.** Check the real docs before changing the JEV integration: `https://api.impossibl.com/llms.txt`, `https://api.impossibl.com/openapi.yaml`, `https://impossibl.com/docs`. If something is not documented, ask rather than guess.
4. **Easy beats feature-rich.** A first-time user must go from "opened the app" to "watching rows get answered" in under 60 seconds without reading docs.
5. **Never fabricate numbers.** Costs and row estimates come from real measurements (`npm run benchmark`).
6. Small, logical commits with conventional messages (`feat:`, `fix:`, `chore:`, `docs:`). Don't push unless asked.

---

## 1. Stack & layout

- **Monorepo** with npm workspaces (no Nx/Turborepo).
- **Server:** [Hono](https://hono.dev) on Node.js 22.13+, TypeScript. Bundled with tsup (all deps inlined; `removeNodeProtocol: false` keeps `node:sqlite` intact).
- **Storage:** SQLite through the built-in `node:sqlite` (no extra dependency). File at `DATABASE_PATH` (default `data/yesornojev.sqlite`, relative to `apps/server`), created on first start with `CREATE TABLE IF NOT EXISTS` and reused afterwards. Git-ignored (`*.sqlite*`); in Docker it lives in the `yesornojev-data` volume.
- **Web:** [Vite](https://vitejs.dev) + React + TypeScript, plain CSS with design tokens. State in zustand, CSV parsing with Papa Parse, virtualized table with TanStack Virtual. Datasets come from the server; the browser only keeps settings and the selected dataset.
- **Shared:** `packages/shared`, types and constants used by both sides.
- **Docker:** `docker compose up --build` serves everything on `http://localhost:3000` (one container; the server also serves the built web app).
- **Tooling:** Vitest, ESLint (typescript-eslint), TypeScript `~6.0` (typescript-eslint does not support 7 yet).

```
apps/server/         Hono API
  src/lib/jev.ts       JEV client: request builder, response parser, retries
  src/lib/db.ts        SQLite store: datasets, rows, latest run results
  src/lib/jobs.ts      in-memory job runner (worker pool, events, cancel, persistence hooks)
  src/lib/pricing.ts   benchmark data + live model price
  src/app.ts           HTTP routes (incl. SSE)
  src/scripts/benchmark.ts  real cost measurement -> src/data/benchmark.json
apps/web/            Vite + React app
  src/styles/tokens.css    impossibl design tokens (dark + light)
  src/components/          Welcome, Workspace, DataTable, JevBot, ...
  src/lib/                 csv, filters, export, api client
packages/shared/     shared types/constants
docs/media/          demo.mp4 + demo.gif (shown in the README)
```

Root scripts: `dev`, `build`, `start`, `test`, `typecheck`, `lint`, `benchmark`.

---

## 2. Product

### 2.1 Welcome screen
- Hero **"$3 free"** and *"that's enough to answer ~N rows"*, where `N = floor(3 / averageCostUsd)` from the committed benchmark.
- API key field (show/hide). The key is validated server-side (`GET /v1/account`), kept only in the browser, and forwarded per request in the `x-impossibl-key` header.
- *"continue with the server key"* when the server has `IMPOSSIBL_API_KEY` (and `ALLOW_SERVER_KEY` is not `false`).
- Link to create an account at https://impossibl.com. Footer: "powered by" + impossibl logo.

### 2.2 Workspace
- **Top bar:** app name, question input (cycles GTM suggestions while empty; <kbd>Tab</kbd> accepts, <kbd>Enter</kbd> runs, <kbd>/</kbd> focuses), filter popover (per column: contains / numeric range; plus verdict yes/no/error/pending), export modal, parallel JEVs stepper (1–10), theme toggle.
- **Sidebar:** CSV cards (name, rows, columns, yes/no bar), rename, remove, add (button or drag-and-drop). No bundled data: the app only holds what users upload.
- **Table:** pinned `#`, robot and verdict columns; yes/no badges with probability pop in as results arrive; run status with counts, cost, stop, "follow the jevs" and retry-errors.
- **Run rules:** a new question starts over; re-asking the same question only fills missing/errored rows; active filters limit which rows are sent.
- **Export:** only yes, only no, or every row plus a new verdict column the user names (default: slug of the question).

---

## 3. JEV integration (verified against the live API)

JEV is the `typesafe-ai/jev` evaluation model at `POST https://api.impossibl.com/v1/systemone` (Bearer key). It does not generate text; it answers typed questions about a `state`. Each CSV row is the `state` object, with one `noul` (yes/no) question:

```json
{
  "model": "typesafe-ai/jev",
  "state": { "name": "Jane Doe", "title": "VP of Sales", "budget": "Approved" },
  "questions": {
    "verdict": {
      "type": "noul",
      "instructions": "Is the following statement true for this data?\nStatement: Is this a hot lead?\n...",
      "criteria": { "true": "Yes: ...", "false": "No: ..." }
    }
  }
}
```

Response: `{ "model": "jev-1.13.0", "answers": { "verdict": { "type": "noul", "noul": 0.91 } }, "usage": { "input_tokens": 339, "output_tokens": 21 } }`.

- `noul >= 0.5` means yes, otherwise no. Malformed answers become `error` rows.
- Billed on input tokens only; the live price is on the public `GET /v1/models`. The exact billed cost per call is `costCredits` (micro-USD) in `GET /v1/requests`.
- 401/403/402 stop the whole job; 408/429/5xx/network errors retry up to 2 times with backoff.
- Token budget is about 32k per call (state + question).

### Server API
- `GET /api/health`, `GET /api/config`, `GET /api/pricing`, `POST /api/key/validate`
- `GET /api/datasets`, `POST /api/datasets` `{ name, columns, numericColumns, rows }`, `GET|PATCH|DELETE /api/datasets/:id`
- `POST /api/datasets/:id/runs` `{ question, indices?, concurrency }` returns `jobId` (409 if one is already running). A new question wipes previous results; the same question only re-asks the given rows.
- `GET /api/jobs/:id/events` (SSE: `row:started`, `row:done`, `job:progress`, `job:done`; replays past events to late subscribers)
- `POST /api/jobs/:id/cancel`
- Every result is written to SQLite as it arrives. Jobs themselves run in memory: on startup, runs left `running` are marked `cancelled`. Concurrency is capped at 10 on the server and the client.

### Cost benchmark
`npm run benchmark -- path/to/file.csv ["question"]` makes 10 real calls over the first rows of a CSV you pass, reads the billed cost from the request log, and writes `apps/server/src/data/benchmark.json` (committed). Re-run it when the model or pricing changes.

---

## 4. Visual design

Source of truth: **https://impossibl.com/design**, "black, mono, lowercase, sharp. ascii is the voice, dither is the data."

- Tokens live in `apps/web/src/styles/tokens.css`. White is the only brand color; success and error are text-level accents. Light mode is a deliberate mirror of the gray ramp.
- Type: IBM Plex Mono for everything; figures use a light display face (Inter Tight Light as the open stand-in for RT Alias Rough). Lowercase UI copy.
- Controls: sharp corners, 1px borders, 32px buttons, 44px inputs. Motion easing `cubic-bezier(0.16, 1, 0.3, 1)`, ≤120ms feedback, 200ms reveals.
- Brand SVGs in `apps/web/public/brand/` (white for dark, black for light). Do not alter them.
- Respect `prefers-reduced-motion`; keep keyboard access (focus rings, Esc closes dialogs).

### JevBot
The row robot is impossibl's 7×7 identity sprite (gray head, white eyes). The eyes are the only moving part and they **cut, never tween** (`step-end` animations). States: `idle` (blinks, glances left/right with per-row random timing), `thinking`, `yes` (bright head, nod), `no` (dim head, head shake), `error` (red glitching eyes).

---

## 5. Quality bar

- `npm test`, `npm run typecheck` and `npm run lint` pass.
- Tests cover the request builder and parser, retries and fatal errors, the SQLite store (create-or-reuse, restart, cascade delete), the job runner (concurrency cap, errors, cancel), the SSE route, CSV parsing, filters and export (all three modes, CSV escaping).
- `docker compose up --build` on a clean clone (with `.env`) works end-to-end.
- Before shipping UI changes, check in a real browser: welcome → upload a CSV → ask → live fill → filter → export → theme toggle → stop mid-run.

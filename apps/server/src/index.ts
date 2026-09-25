import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "./app.js";
import { readEnv } from "./env.js";
import { Store } from "./lib/db.js";
import { createJevClient } from "./lib/jev.js";
import { JobManager } from "./lib/jobs.js";
import { createPriceLookup } from "./lib/pricing.js";

const env = readEnv();
const databasePath = resolve(env.databasePath);
const store = new Store(databasePath);
store.markInterruptedRuns();
const jobs = new JobManager({
  askJev: createJevClient({ apiBase: env.apiBase, model: env.model }),
  pricePerInputToken: createPriceLookup(env.apiBase, env.model),
});

const root = new Hono();
root.route("/", createApp({ env, jobs, store }));

// In production the server also serves the built web app (single container).
const webDist = env.webDist ? resolve(env.webDist) : undefined;
if (webDist && existsSync(webDist)) {
  const indexHtml = await readFile(join(webDist, "index.html"), "utf8");
  root.use("/*", serveStatic({ root: webDist }));
  root.get("*", (c) => c.html(indexHtml));
}

serve({ fetch: root.fetch, port: env.port }, (info) => {
  const keyStatus = env.serverKey ? "server key loaded" : "no server key (users must paste their own)";
  console.log(`YesOrNoJev server listening on http://localhost:${info.port} (${keyStatus})`);
  console.log(`Datasets stored in ${databasePath}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    store.close();
    process.exit(0);
  });
}

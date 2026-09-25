export interface ServerEnv {
  port: number;
  apiBase: string;
  model: string;
  serverKey: string | undefined;
  allowServerKey: boolean;
  webDist: string | undefined;
  /** SQLite file with datasets and results. Created on first start, reused afterwards. */
  databasePath: string;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const serverKey = source.IMPOSSIBL_API_KEY?.trim() || undefined;
  return {
    port: Number(source.PORT) || 3000,
    apiBase: (source.IMPOSSIBL_API_BASE || "https://api.impossibl.com").replace(/\/+$/, ""),
    model: source.JEV_MODEL || "typesafe-ai/jev",
    serverKey,
    allowServerKey: source.ALLOW_SERVER_KEY !== "false",
    webDist: source.WEB_DIST || undefined,
    databasePath: source.DATABASE_PATH || "data/yesornojev.sqlite",
  };
}

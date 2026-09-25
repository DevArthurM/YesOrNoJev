import { useEffect, useState, type FormEvent } from "react";
import { IMPOSSIBL_SIGNUP_URL, type AppConfig, type PricingInfo } from "@yesornojev/shared";
import { api } from "../lib/api";
import { formatInt, formatUsd } from "../lib/format";
import { useSettings } from "../store/settings";
import { AppName, PoweredBy } from "./Brand";
import { JevBot } from "./JevBot";
import { ThemeToggle } from "./ThemeToggle";

export function Welcome({ config }: { config?: AppConfig }) {
  const [pricing, setPricing] = useState<PricingInfo>();
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [checking, setChecking] = useState<"own" | "server" | undefined>();
  const [error, setError] = useState<string>();
  const { useOwnKey, useServerKey } = useSettings();

  useEffect(() => {
    api.pricing().then(setPricing).catch(() => undefined);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return setError("Paste your API key first.");
    setChecking("own");
    setError(undefined);
    try {
      await api.validateKey(trimmed);
      useOwnKey(trimmed);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(undefined);
    }
  };

  const continueWithServerKey = async () => {
    setChecking("server");
    setError(undefined);
    try {
      await api.validateKey();
      useServerKey();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(undefined);
    }
  };

  return (
    <div className="welcome">
      <header className="welcome__top">
        <AppName />
        <ThemeToggle />
      </header>

      <main className="welcome__main">
        <div className="welcome__bots" aria-hidden="true">
          {Array.from({ length: 7 }, (_, i) => (
            <JevBot key={i} seed={i + 3} size={28} />
          ))}
        </div>

        <h1 className="welcome__hero figure">$3 free</h1>

        <p className="welcome__claim">
          that&apos;s enough to answer{" "}
          <span className="figure welcome__rows">~{pricing ? formatInt(pricing.rowsForFreeCredit) : "…"}</span> rows
          with a yes or no.
        </p>
        {pricing && (
          <p className="welcome__footnote">
            {formatUsd(pricing.averageCostUsd)} per row on average · measured over {pricing.sampleSize} real jev calls
          </p>
        )}

        <ol className="welcome__steps">
          <li><span>01</span> add a csv</li>
          <li><span>02</span> ask a yes/no question</li>
          <li><span>03</span> watch the jevs answer every row</li>
        </ol>

        <form className="welcome__form" onSubmit={submit}>
          <label className="label" htmlFor="api-key">impossibl.com api key</label>
          <div className="key-input">
            <input
              id="api-key"
              className="input"
              type={showKey ? "text" : "password"}
              placeholder="paste your impossibl.com api key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="key-input__toggle" onClick={() => setShowKey((v) => !v)}>
              {showKey ? "hide" : "show"}
            </button>
          </div>
          <button className="button button--primary button--wide" type="submit" disabled={Boolean(checking)}>
            {checking === "own" ? "checking…" : "continue →"}
          </button>
          {config?.hasServerKey && (
            <button type="button" className="button button--ghost button--wide" onClick={continueWithServerKey} disabled={Boolean(checking)}>
              {checking === "server" ? "checking…" : "continue with the server key"}
            </button>
          )}
          {error && <p className="form-error">{error}</p>}
        </form>

        <a className="welcome__signup" href={IMPOSSIBL_SIGNUP_URL} target="_blank" rel="noreferrer">
          no key yet? create your free account at impossibl.com ↗
        </a>
      </main>

      <footer className="welcome__footer">
        <PoweredBy />
      </footer>
    </div>
  );
}

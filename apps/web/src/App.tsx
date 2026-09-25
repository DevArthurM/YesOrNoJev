import { useEffect, useState } from "react";
import type { AppConfig } from "@yesornojev/shared";
import { Toasts } from "./components/Toasts";
import { Welcome } from "./components/Welcome";
import { Workspace } from "./components/Workspace";
import { api } from "./lib/api";
import { useSettings } from "./store/settings";

export function App() {
  const { keyMode, theme } = useSettings();
  const [config, setConfig] = useState<AppConfig>();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    api.config().then(setConfig).catch(() => undefined);
  }, []);

  return (
    <>
      {keyMode === "none" ? <Welcome config={config} /> : <Workspace config={config} />}
      <Toasts />
    </>
  );
}

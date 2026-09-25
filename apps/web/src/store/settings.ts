import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_PARALLEL_JEVS, clampParallel } from "@yesornojev/shared";

export type Theme = "dark" | "light";
/** "server" uses the key from the server's .env, "own" a key the user pasted. */
export type KeyMode = "none" | "server" | "own";

interface SettingsState {
  keyMode: KeyMode;
  apiKey: string;
  theme: Theme;
  parallel: number;
  useServerKey: () => void;
  useOwnKey: (key: string) => void;
  signOut: () => void;
  toggleTheme: () => void;
  setParallel: (n: number) => void;
}

const systemTheme = (): Theme =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      keyMode: "none",
      apiKey: "",
      theme: systemTheme(),
      parallel: DEFAULT_PARALLEL_JEVS,
      useServerKey: () => set({ keyMode: "server", apiKey: "" }),
      useOwnKey: (apiKey) => set({ keyMode: "own", apiKey }),
      signOut: () => set({ keyMode: "none", apiKey: "" }),
      toggleTheme: () => set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
      setParallel: (n) => set({ parallel: clampParallel(n) }),
    }),
    { name: "yonj-settings" },
  ),
);

/** The key to forward to our server, or undefined to let it use its own. */
export const userApiKey = () => {
  const { keyMode, apiKey } = useSettings.getState();
  return keyMode === "own" ? apiKey : undefined;
};

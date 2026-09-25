import { useSettings } from "../store/settings";

export function ThemeToggle() {
  const { theme, toggleTheme } = useSettings();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button className="icon-button" onClick={toggleTheme} aria-label={`switch to ${next} mode`} title={`${next} mode`}>
      {theme === "dark" ? "☾" : "☼"}
    </button>
  );
}

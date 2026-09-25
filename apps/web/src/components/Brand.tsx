import { IMPOSSIBL_SIGNUP_URL } from "@yesornojev/shared";
import { useSettings } from "../store/settings";

/** The impossibl icon, swapped for the current theme. */
export function ImpossiblIcon({ size = 14 }: { size?: number }) {
  const theme = useSettings((s) => s.theme);
  const src = theme === "dark" ? "/brand/impossibl-icon-white.svg" : "/brand/impossibl-icon-black.svg";
  return <img className="impossibl-icon" src={src} width={size} height={size} alt="" aria-hidden="true" />;
}

export function PoweredBy() {
  return (
    <a className="powered-by" href={IMPOSSIBL_SIGNUP_URL} target="_blank" rel="noreferrer">
      <span>powered by</span>
      <ImpossiblIcon />
      <span className="powered-by__name">impossibl</span>
    </a>
  );
}

export function AppName({ cursor = true }: { cursor?: boolean }) {
  return (
    <span className="app-name">
      yes or no jev?{cursor && <span className="cursor-blink" aria-hidden="true">▌</span>}
    </span>
  );
}

"use client";

import FxFrame from "./FxFrame";

/**
 * App-wide wallpaper. Mounted once in the root layout so the rain-on-glass
 * canvas persists across route changes — the background stays identical from
 * the login hero into the app, and only the foreground content fades.
 */
export default function BackgroundFx() {
  return (
    <div className="app-bg" aria-hidden="true">
      <FxFrame className="app-bg-rain" src="/rain-on-glass.html" />
      <div className="app-bg-tint" />
    </div>
  );
}

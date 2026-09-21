"use client";

import { useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  window.addEventListener("eiga-theme", listener);
  return () => window.removeEventListener("eiga-theme", listener);
}

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function ThemeControl() {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "dark");
  const light = theme === "light";

  return (
    <button
      type="button"
      className="eiga-button eiga-theme-button"
      aria-label="Light mode"
      aria-pressed={light}
      title={`Switch to ${light ? "dark" : "light"} mode`}
      onClick={() => {
        const next = light ? "dark" : "light";
        document.documentElement.dataset.theme = next;
        document
          .querySelector('meta[name="theme-color"]')
          ?.setAttribute("content", next === "light" ? "#f3f1ea" : "#101114");
        try {
          localStorage.setItem("eiga-theme", next);
        } catch {
          // The switch still works when the browser disallows storage.
        }
        window.dispatchEvent(new Event("eiga-theme"));
      }}
    >
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="6" stroke="currentColor" />
        <path d="M10 4a6 6 0 0 1 0 12Z" fill="currentColor" />
      </svg>
      {light ? "Dark mode" : "Light mode"}
    </button>
  );
}

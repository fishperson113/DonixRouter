import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./globals.css";
import "material-symbols/outlined.css";
import { ThemeProvider } from "./shared/components/ThemeProvider";
import { RuntimeI18nProvider } from "./i18n/RuntimeI18nProvider";

// Mark fonts-loaded so material-symbols icons become visible
document.documentElement.classList.add("fonts-loaded");

const STALE_CHUNK_RELOAD_KEY = "donixrouter:stale-chunk-reload";

function isStaleChunkError(value) {
  const message = typeof value === "string"
    ? value
    : value?.message || value?.reason?.message || "";
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("ChunkLoadError")
  );
}

function reloadForStaleChunk() {
  const currentPath = `${window.location.pathname}${window.location.search}`;
  try {
    const raw = sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY);
    if (raw) {
      const previous = JSON.parse(raw);
      const isSamePath = previous?.path === currentPath;
      const isRecent = Date.now() - (previous?.at || 0) < 15000;
      if (isSamePath && isRecent) {
        console.error("[ui] Stale chunk reload already attempted for", currentPath);
        return;
      }
    }
    sessionStorage.setItem(
      STALE_CHUNK_RELOAD_KEY,
      JSON.stringify({ path: currentPath, at: Date.now() })
    );
  } catch {
    // Ignore storage errors and still attempt a hard reload.
  }
  window.location.reload();
}

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  reloadForStaleChunk();
});

window.addEventListener("error", (event) => {
  if (isStaleChunkError(event.error || event.message)) {
    reloadForStaleChunk();
  }
}, true);

window.addEventListener("unhandledrejection", (event) => {
  if (isStaleChunkError(event.reason)) {
    event.preventDefault();
    reloadForStaleChunk();
  }
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <ThemeProvider>
      <RuntimeI18nProvider>
        <App />
      </RuntimeI18nProvider>
    </ThemeProvider>
  </BrowserRouter>
);

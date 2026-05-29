"use client";

import { useEffect } from "react";

const HEIGHT_PAD = 14;
const MIN_H = 140;
const MAX_H = 960;
const WIDTH_SINGLE = 420;
const WIDTH_GRID = 700;
const WIDTH_DASHBOARD = 700;
const MIN_W = 340;
const MAX_W = 900;

function isTauri() {
  return typeof window !== "undefined" && Boolean(window.__TAURI__?.core?.invoke);
}

async function resizeWindow(width, height) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return;
  const w = Math.round(Math.min(Math.max(width, MIN_W), MAX_W));
  const h = Math.round(Math.min(Math.max(height, MIN_H), MAX_H));
  try {
    await invoke("resize_widget", { width: w, height: h });
  } catch {
    // ignore when not in Tauri or permission missing
  }
}

export function useTauriWindowFit(containerRef, accountCount = 0, hasDashboard = false, deps = []) {
  useEffect(() => {
    if (!isTauri()) return undefined;

    document.documentElement.classList.add("quota-widget-fit");

    const el = containerRef.current;
    if (!el) return undefined;

    const targetWidth = hasDashboard
      ? WIDTH_DASHBOARD
      : accountCount >= 2
        ? WIDTH_GRID
        : WIDTH_SINGLE;

    let frame = null;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      resizeWindow(targetWidth, rect.height + HEIGHT_PAD);
    };

    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };

    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);

    return () => {
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
      document.documentElement.classList.remove("quota-widget-fit");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remeasure when widget content changes
  }, [containerRef, accountCount, hasDashboard, ...deps]);
}

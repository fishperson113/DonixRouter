"use client";

import { useEffect, useState } from "react";

const VALID_PERIODS = new Set(["24h", "7d", "30d", "60d", "all"]);
const DEFAULT_PERIOD = "7d";
const RETRY_DELAY_MS = 1500;
const stores = new Map();

function normalizePeriod(period) {
  return VALID_PERIODS.has(period) ? period : DEFAULT_PERIOD;
}

function createStore(period) {
  const listeners = new Set();

  const store = {
    period,
    snapshot: null,
    connected: false,
    es: null,
    reconnectTimer: null,
    emit() {
      const payload = { snapshot: store.snapshot, connected: store.connected };
      for (const listener of listeners) listener(payload);
    },
    scheduleReconnect() {
      if (store.reconnectTimer) return;
      store.reconnectTimer = window.setTimeout(() => {
        store.reconnectTimer = null;
        if (listeners.size > 0) store.connect();
      }, RETRY_DELAY_MS);
    },
    cleanupConnection() {
      if (store.es) {
        store.es.close();
        store.es = null;
      }
      if (store.reconnectTimer) {
        window.clearTimeout(store.reconnectTimer);
        store.reconnectTimer = null;
      }
    },
    connect() {
      if (typeof window === "undefined" || store.es) return;

      const es = new EventSource(`/api/usage/stream?period=${encodeURIComponent(period)}`);
      store.es = es;

      es.onopen = () => {
        store.connected = true;
        store.emit();
      };

      es.onmessage = (event) => {
        try {
          store.snapshot = JSON.parse(event.data);
          store.connected = true;
          store.emit();
        } catch (error) {
          console.error("[useUsageStream] Failed to parse usage stream payload:", error);
        }
      };

      es.onerror = () => {
        store.connected = false;
        store.emit();
        store.cleanupConnection();
        store.scheduleReconnect();
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      listener({ snapshot: store.snapshot, connected: store.connected });

      if (listeners.size === 1) {
        store.connect();
      }

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          store.cleanupConnection();
          stores.delete(period);
        }
      };
    },
  };

  return store;
}

function getStore(period) {
  const normalized = normalizePeriod(period);
  if (!stores.has(normalized)) {
    stores.set(normalized, createStore(normalized));
  }
  return stores.get(normalized);
}

export function useUsageStream(period = DEFAULT_PERIOD) {
  const normalized = normalizePeriod(period);
  const [state, setState] = useState(() => {
    const store = getStore(normalized);
    return { snapshot: store.snapshot, connected: store.connected };
  });

  useEffect(() => {
    const store = getStore(normalized);
    return store.subscribe(setState);
  }, [normalized]);

  return state;
}

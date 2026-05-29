"use client";

import { useEffect, useState, useCallback } from "react";

const RETRY_DELAY_MS = 2000;
const POLL_INTERVAL_MS = 60_000;
const INITIAL_POLL_DELAY_MS = 3500;

let globalStore = null;

function apiBase() {
  if (typeof window === "undefined") return "";
  return window.location.origin || "";
}

function applyActiveIds(store, ids) {
  if (Array.isArray(ids)) {
    store.activeConnectionIds = ids;
  }
}

function createStore() {
  const listeners = new Set();

  const store = {
    snapshot: null,
    connected: false,
    activeConnectionIds: [],
    es: null,
    reconnectTimer: null,
    pollTimer: null,
    initialPollTimer: null,
    pollInFlight: false,
    emit() {
      const payload = {
        snapshot: store.snapshot,
        connected: store.connected,
        activeConnectionIds: store.activeConnectionIds,
      };
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
    handlePayload(data) {
      if (!data || typeof data !== "object") return;

      if (data.connections && data.quotas) {
        store.snapshot = data;
        store.connected = true;
        applyActiveIds(store, data.activeConnectionIds);
        store.emit();
        return;
      }

      if (data.type === "active_update") {
        applyActiveIds(store, data.activeConnectionIds);
        store.emit();
        return;
      }

      if (data.type === "usage_update") {
        store.connected = true;
        store.emit();
        store.fetchSnapshot();
      }
    },
    async fetchSnapshot() {
      if (store.pollInFlight || typeof fetch === "undefined") return;
      store.pollInFlight = true;
      try {
        const res = await fetch(`${apiBase()}/api/usage/quota-snapshot`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.connections && data?.quotas) {
          store.snapshot = data;
          applyActiveIds(store, data.activeConnectionIds);
          store.emit();
        }
      } catch (error) {
        console.warn("[useQuotaStream] snapshot poll failed:", error);
      } finally {
        store.pollInFlight = false;
      }
    },
    startPolling() {
      if (store.pollTimer) return;
      store.pollTimer = window.setInterval(() => {
        store.fetchSnapshot();
      }, POLL_INTERVAL_MS);
    },
    stopPolling() {
      if (store.pollTimer) {
        window.clearInterval(store.pollTimer);
        store.pollTimer = null;
      }
      if (store.initialPollTimer) {
        window.clearTimeout(store.initialPollTimer);
        store.initialPollTimer = null;
      }
    },
    connect() {
      if (typeof window === "undefined" || store.es) return;

      store.startPolling();

      if (store.initialPollTimer) {
        window.clearTimeout(store.initialPollTimer);
      }
      store.initialPollTimer = window.setTimeout(() => {
        store.initialPollTimer = null;
        if (!store.snapshot) store.fetchSnapshot();
      }, INITIAL_POLL_DELAY_MS);

      if (typeof EventSource === "undefined") {
        console.warn("[useQuotaStream] EventSource unavailable — using HTTP polling");
        store.connected = false;
        store.fetchSnapshot();
        store.emit();
        return;
      }

      let es;
      try {
        es = new EventSource(`${apiBase()}/api/usage/quota-stream`);
      } catch (error) {
        console.error("[useQuotaStream] Failed to create EventSource:", error);
        store.connected = false;
        store.fetchSnapshot();
        store.emit();
        return;
      }
      store.es = es;

      es.onopen = () => {
        store.connected = true;
        store.emit();
      };

      es.onmessage = (event) => {
        try {
          store.handlePayload(JSON.parse(event.data));
        } catch (error) {
          console.error("[useQuotaStream] Failed to parse quota stream payload:", error);
        }
      };

      es.onerror = () => {
        store.connected = false;
        store.emit();
        store.cleanupConnection();
        store.fetchSnapshot();
        store.scheduleReconnect();
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      listener({
        snapshot: store.snapshot,
        connected: store.connected,
        activeConnectionIds: store.activeConnectionIds,
      });

      if (listeners.size === 1) {
        store.connect();
      }

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          store.cleanupConnection();
          store.stopPolling();
          globalStore = null;
        }
      };
    },
    forceRefresh() {
      store.cleanupConnection();
      store.fetchSnapshot();
      store.connect();
    },
  };

  return store;
}

function getStore() {
  if (!globalStore) {
    globalStore = createStore();
  }
  return globalStore;
}

export function useQuotaStream() {
  const [state, setState] = useState(() => {
    const store = getStore();
    return {
      snapshot: store.snapshot,
      connected: store.connected,
      activeConnectionIds: store.activeConnectionIds,
    };
  });

  useEffect(() => {
    const store = getStore();
    return store.subscribe(setState);
  }, []);

  const forceRefresh = useCallback(() => {
    const store = getStore();
    store.forceRefresh();
  }, []);

  return { ...state, forceRefresh };
}

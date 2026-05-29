"use client";

import { useEffect, useState, useCallback } from "react";

const RETRY_DELAY_MS = 2000;

let globalStore = null;

function createStore() {
  const listeners = new Set();

  const store = {
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

      const es = new EventSource("/api/usage/quota-stream");
      store.es = es;

      es.onopen = () => {
        store.connected = true;
        store.emit();
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Full snapshot (has connections + quotas)
          if (data.connections && data.quotas) {
            store.snapshot = data;
            store.connected = true;
            store.emit();
          }
          // Lightweight usage_update notification — emit so listeners know to update countdown etc
          else if (data.type === "usage_update") {
            store.connected = true;
            store.emit();
          }
        } catch (error) {
          console.error("[useQuotaStream] Failed to parse quota stream payload:", error);
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
          globalStore = null;
        }
      };
    },
    // Force a manual refresh by reconnecting
    forceRefresh() {
      store.cleanupConnection();
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
    return { snapshot: store.snapshot, connected: store.connected };
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

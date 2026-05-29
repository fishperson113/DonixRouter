/**
 * Singleton ProxyPool instance.
 * Import this to get/create the shared proxy pool.
 */

import { ProxyPool } from "./proxy-pool.js";

let _instance = null;

export function getProxyPool() {
  if (!_instance) {
    _instance = new ProxyPool();
    // Start periodic health checks if proxies exist
    if (_instance.getAll().length > 0) {
      _instance.startHealthCheckTimer();
    }
  }
  return _instance;
}

export function destroyProxyPool() {
  if (_instance) {
    _instance.destroy();
    _instance = null;
  }
}

/**
 * TLS Transport abstraction — decouples upstream request logic from
 * the concrete transport implementation.
 *
 * Singleton: call initTransport() once at startup, then getTransport() anywhere.
 *
 * If the native addon is unavailable, falls back to a plain fetch-based transport
 * (no TLS fingerprint impersonation, but still functional).
 */

import { isNativeAvailable } from "./native-transport.js";

let _transport = null;
let _transportType = "none";

/**
 * Minimal fetch-based fallback transport.
 * No TLS fingerprint — uses Node.js default TLS stack.
 */
class FetchTransport {
  isImpersonate() { return false; }

  async post(url, headers, body, signal, _timeoutSec, proxyUrl) {
    const fetchOpts = {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body,
      signal,
    };

    // Use proxy agent if proxyUrl is specified
    if (proxyUrl) {
      try {
        const { HttpsProxyAgent } = await import("https-proxy-agent");
        fetchOpts.agent = new HttpsProxyAgent(proxyUrl);
      } catch { /* proxy agent unavailable — direct connection */ }
    }

    const res = await fetch(url, fetchOpts);

    return {
      status: res.status,
      headers: res.headers,
      body: res.body,
      setCookieHeaders: res.headers.getSetCookie?.() || [],
    };
  }

  async get(url, headers, timeoutSec) {
    const controller = new AbortController();
    const timer = timeoutSec ? setTimeout(() => controller.abort(), timeoutSec * 1000) : null;
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      const body = await res.text();
      return { status: res.status, body };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async getWithCookies(url, headers, timeoutSec) {
    const result = await this.get(url, headers, timeoutSec);
    return { ...result, setCookieHeaders: [] };
  }

  async simplePost(url, headers, body, timeoutSec) {
    const controller = new AbortController();
    const timer = timeoutSec ? setTimeout(() => controller.abort(), timeoutSec * 1000) : null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      const text = await res.text();
      return { status: res.status, body: text };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * Initialize the transport singleton. Must be called once at startup.
 */
export async function initTransport() {
  if (_transport) return _transport;

  if (isNativeAvailable()) {
    try {
      const { createNativeTransport } = await import("./native-transport.js");
      _transport = await createNativeTransport();
      _transportType = "native";
      console.log("[TLS] Using native (rustls) transport");
      return _transport;
    } catch (err) {
      console.warn(`[TLS] Native transport init failed: ${err.message}`);
      console.warn("[TLS] Falling back to fetch-based transport (no TLS fingerprint)");
    }
  } else {
    console.log("[TLS] Native addon not found — using fetch-based transport");
  }

  _transport = new FetchTransport();
  _transportType = "fetch";
  return _transport;
}

/**
 * Get the initialized transport. Falls back to fetch if not initialized.
 */
export function getTransport() {
  if (!_transport) {
    console.warn("[TLS] Transport not initialized. Using fetch fallback.");
    _transport = new FetchTransport();
    _transportType = "fetch";
  }
  return _transport;
}

/** Get transport diagnostic info. */
export function getTransportInfo() {
  return {
    type: _transportType,
    initialized: _transport !== null,
    impersonate: _transport?.isImpersonate?.() ?? false,
  };
}

/** Reset transport singleton (for testing). */
export function resetTransport() {
  _transport = null;
  _transportType = "none";
}

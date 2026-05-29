/**
 * Proxy detection and management.
 *
 * Auto-detects local proxies (mihomo/clash, v2ray, etc.) by probing common ports.
 * Called once at startup, result is cached for the process lifetime.
 */

import { createConnection } from "net";
import { lookup } from "dns/promises";

/**
 * Common local proxy ports to auto-detect.
 * Checked in order: mihomo/clash, v2ray, SOCKS5 common.
 */
const PROXY_PORTS = [
  { port: 7890, proto: "http" },   // mihomo / clash
  { port: 7897, proto: "http" },   // clash-verge
  { port: 10809, proto: "http" },  // v2ray HTTP
  { port: 1080, proto: "socks5" }, // SOCKS5 common
  { port: 10808, proto: "socks5" },// v2ray SOCKS5
];

/**
 * Hosts to probe for proxy detection.
 * 127.0.0.1 — bare-metal / host machine.
 * host.docker.internal — Docker container → host machine
 */
const PROXY_HOSTS = ["127.0.0.1", "host.docker.internal"];

let _proxyUrl; // undefined = not yet detected

/** Probe a TCP port on the given host. Resolves true if a server is listening. */
function probePort(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.setTimeout(timeoutMs);
    sock.on("timeout", () => { sock.destroy(); resolve(false); });
    sock.on("error", () => { resolve(false); });
  });
}

/**
 * Detect a local proxy by probing common ports on localhost and Docker host.
 * Called once at startup, result is cached.
 */
async function detectLocalProxy() {
  for (const host of PROXY_HOSTS) {
    for (const { port, proto } of PROXY_PORTS) {
      if (await probePort(host, port)) {
        // Resolve hostname to IP to avoid DNS issues in some transports
        let resolvedHost = host;
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
          try {
            const { address } = await lookup(host);
            resolvedHost = address;
          } catch { /* use original hostname as fallback */ }
        }
        const url = `${proto}://${resolvedHost}:${port}`;
        console.log(`[Proxy] Auto-detected local proxy: ${url}`);
        return url;
      }
    }
  }
  return null;
}

/**
 * Initialize proxy detection. Called once at startup.
 * Priority: PROXY_URL env > auto-detect local ports.
 */
export async function initProxy() {
  const envProxy = process.env.PROXY_URL || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
  if (envProxy) {
    _proxyUrl = envProxy;
    console.log(`[Proxy] Using configured proxy: ${_proxyUrl}`);
    return;
  }
  _proxyUrl = await detectLocalProxy();
  if (!_proxyUrl) {
    console.log("[Proxy] No local proxy detected — direct connection");
  }
}

/**
 * Get the detected proxy URL (or null if no proxy).
 */
export function getProxyUrl() {
  return _proxyUrl ?? null;
}

/**
 * Reset the cached proxy state (for testing).
 */
export function resetProxyCache() {
  _proxyUrl = undefined;
}

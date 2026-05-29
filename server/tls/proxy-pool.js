/**
 * ProxyPool — per-account proxy management with health checks.
 *
 * Supports manual assignment, "auto" round-robin, "direct" (no proxy),
 * and "global" (use the globally detected proxy).
 *
 * Persistence: data/proxies.json (atomic write via tmp + rename).
 * JavaScript port of codex-proxy-dev/src/proxy/proxy-pool.ts
 */

import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
} from "fs";
import { resolve, dirname } from "path";
import { DATA_DIR } from "#lib/dataDir.js";
import { getTransport } from "./transport.js";

function getProxiesFile() {
  return resolve(DATA_DIR, "proxies.json");
}

const HEALTH_CHECK_URL = "https://api.ipify.org?format=json";
const DEFAULT_HEALTH_INTERVAL_MIN = 5;

function maskProxyUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return url;
  }
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class ProxyPool {
  constructor(transport) {
    this.proxies = new Map();
    this.assignments = new Map(); // accountId → proxyId
    this.healthIntervalMin = DEFAULT_HEALTH_INTERVAL_MIN;
    this.persistTimer = null;
    this.healthTimer = null;
    this._roundRobinIndex = 0;
    this.injectedTransport = transport;
    this.load();
  }

  // ── CRUD ──────────────────────────────────────────────────────────

  add(name, url) {
    const trimmedUrl = url.trim();
    for (const existing of this.proxies.values()) {
      if (existing.url === trimmedUrl) return existing.id;
    }
    const id = randomHex(8);
    const entry = {
      id,
      name: name.trim(),
      url: trimmedUrl,
      status: "active",
      health: null,
      addedAt: new Date().toISOString(),
    };
    this.proxies.set(id, entry);
    this.persistNow();
    return id;
  }

  remove(id) {
    if (!this.proxies.delete(id)) return false;
    for (const [accountId, proxyId] of this.assignments) {
      if (proxyId === id) this.assignments.delete(accountId);
    }
    this.persistNow();
    return true;
  }

  update(id, fields) {
    const entry = this.proxies.get(id);
    if (!entry) return false;
    if (fields.name !== undefined) entry.name = fields.name.trim();
    if (fields.url !== undefined) {
      entry.url = fields.url.trim();
      entry.health = null;
      entry.status = "active";
    }
    this.schedulePersist();
    return true;
  }

  getAll() {
    return Array.from(this.proxies.values());
  }

  getAllMasked() {
    return this.getAll().map((p) => ({ ...p, url: maskProxyUrl(p.url) }));
  }

  getById(id) {
    return this.proxies.get(id);
  }

  enable(id) {
    const entry = this.proxies.get(id);
    if (!entry) return false;
    entry.status = "active";
    this.schedulePersist();
    return true;
  }

  disable(id) {
    const entry = this.proxies.get(id);
    if (!entry) return false;
    entry.status = "disabled";
    this.schedulePersist();
    return true;
  }

  // ── Assignment ────────────────────────────────────────────────────

  assign(accountId, proxyId) {
    this.assignments.set(accountId, proxyId);
    this.persistNow();
  }

  bulkAssign(assignmentsList) {
    for (const { accountId, proxyId } of assignmentsList) {
      this.assignments.set(accountId, proxyId);
    }
    this.persistNow();
  }

  unassign(accountId) {
    if (this.assignments.delete(accountId)) this.persistNow();
  }

  getAssignment(accountId) {
    return this.assignments.get(accountId) ?? "global";
  }

  getAllAssignments() {
    const result = [];
    for (const [accountId, proxyId] of this.assignments) {
      result.push({ accountId, proxyId });
    }
    return result;
  }

  getAssignmentDisplayName(accountId) {
    const assignment = this.getAssignment(accountId);
    if (assignment === "global") return "Global Default";
    if (assignment === "direct") return "Direct (No Proxy)";
    if (assignment === "auto") return "Auto (Round-Robin)";
    const proxy = this.proxies.get(assignment);
    return proxy ? proxy.name : "Unknown Proxy";
  }

  // ── Resolution ────────────────────────────────────────────────────

  resolveProxyUrl(accountId, skipUnhealthy = false) {
    const assignment = this.getAssignment(accountId);
    if (assignment === "global") return undefined;
    if (assignment === "direct") return null;
    if (assignment === "auto") return this._pickRoundRobin();

    const proxy = this.proxies.get(assignment);
    if (!proxy) return undefined;
    if (proxy.status === "disabled") return undefined;
    if (proxy.status === "unreachable" && skipUnhealthy) return undefined;
    return proxy.url;
  }

  _pickRoundRobin() {
    const active = Array.from(this.proxies.values()).filter((p) => p.status === "active");
    if (active.length === 0) return undefined;
    this._roundRobinIndex = this._roundRobinIndex % active.length;
    const picked = active[this._roundRobinIndex];
    this._roundRobinIndex = (this._roundRobinIndex + 1) % active.length;
    return picked.url;
  }

  // ── Health Check ──────────────────────────────────────────────────

  async healthCheck(id) {
    const proxy = this.proxies.get(id);
    if (!proxy) throw new Error(`Proxy ${id} not found`);

    const transport = this.injectedTransport ?? getTransport();
    const start = Date.now();

    try {
      const result = await transport.get(HEALTH_CHECK_URL, { Accept: "application/json" }, 10, proxy.url);
      const latencyMs = Date.now() - start;

      let exitIp = null;
      try {
        const parsed = JSON.parse(result.body);
        exitIp = parsed.ip ?? null;
      } catch { /* Could not parse IP */ }

      const info = { exitIp, latencyMs, lastChecked: new Date().toISOString(), error: null };
      proxy.health = info;
      if (proxy.status !== "disabled") proxy.status = "active";
      this.schedulePersist();
      return info;
    } catch (err) {
      const latencyMs = Date.now() - start;
      const error = err instanceof Error ? err.message : String(err);
      const info = { exitIp: null, latencyMs, lastChecked: new Date().toISOString(), error };
      proxy.health = info;
      if (proxy.status !== "disabled") proxy.status = "unreachable";
      this.schedulePersist();
      return info;
    }
  }

  async healthCheckAll() {
    const targets = Array.from(this.proxies.values()).filter((p) => p.status !== "disabled");
    if (targets.length === 0) return;
    console.log(`[ProxyPool] Health checking ${targets.length} proxies...`);
    await Promise.allSettled(targets.map((p) => this.healthCheck(p.id)));
    const active = targets.filter((p) => p.status === "active").length;
    console.log(`[ProxyPool] Health check complete: ${active}/${targets.length} active`);
  }

  startHealthCheckTimer() {
    this.stopHealthCheckTimer();
    if (this.proxies.size === 0) return;
    const intervalMs = this.healthIntervalMin * 60 * 1000;
    this.healthTimer = setInterval(() => {
      this.healthCheckAll().catch((err) => {
        console.warn(`[ProxyPool] Periodic health check error: ${err.message || err}`);
      });
    }, intervalMs);
    if (this.healthTimer.unref) this.healthTimer.unref();
    console.log(`[ProxyPool] Health check timer started (every ${this.healthIntervalMin}min)`);
  }

  stopHealthCheckTimer() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  getHealthIntervalMinutes() { return this.healthIntervalMin; }

  setHealthIntervalMinutes(minutes) {
    this.healthIntervalMin = Math.max(1, minutes);
    this.schedulePersist();
    if (this.healthTimer) this.startHealthCheckTimer();
  }

  // ── Persistence ───────────────────────────────────────────────────

  schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, 1000);
  }

  persistNow() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    try {
      const filePath = getProxiesFile();
      const dir = dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const data = {
        proxies: Array.from(this.proxies.values()),
        assignments: this.getAllAssignments(),
        healthCheckIntervalMinutes: this.healthIntervalMin,
      };

      const tmpFile = filePath + ".tmp";
      writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf-8");
      renameSync(tmpFile, filePath);
    } catch (err) {
      console.warn("[ProxyPool] Failed to persist:", err.message || err);
    }
  }

  load() {
    try {
      const filePath = getProxiesFile();
      if (!existsSync(filePath)) return;

      const raw = readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw);

      if (Array.isArray(data.proxies)) {
        for (const p of data.proxies) {
          if (p && typeof p.id === "string" && typeof p.url === "string") {
            this.proxies.set(p.id, {
              id: p.id,
              name: p.name ?? "",
              url: p.url,
              status: p.status ?? "active",
              health: p.health ?? null,
              addedAt: p.addedAt ?? new Date().toISOString(),
            });
          }
        }
      }

      if (Array.isArray(data.assignments)) {
        for (const a of data.assignments) {
          if (a && typeof a.accountId === "string" && typeof a.proxyId === "string") {
            this.assignments.set(a.accountId, a.proxyId);
          }
        }
      }

      if (typeof data.healthCheckIntervalMinutes === "number") {
        this.healthIntervalMin = Math.max(1, data.healthCheckIntervalMinutes);
      }

      if (this.proxies.size > 0) {
        console.log(`[ProxyPool] Loaded ${this.proxies.size} proxies, ${this.assignments.size} assignments`);
      }
    } catch (err) {
      console.warn("[ProxyPool] Failed to load:", err.message || err);
    }
  }

  destroy() {
    this.stopHealthCheckTimer();
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persistNow();
  }
}

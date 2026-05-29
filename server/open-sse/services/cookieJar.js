/**
 * CookieJar — per-account cookie storage for Codex.
 * Adapted from codex-proxy's cookie-jar.ts.
 *
 * Stores cookies (especially cf_clearance from Cloudflare) so that
 * subsequent requests look like a continuous session.
 * Cookies are auto-captured from Set-Cookie headers on Codex responses.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { homedir } from "os";

const CRITICAL_COOKIES = new Set(["cf_clearance", "__cf_bm"]);

function getDataDir() {
  if (process.platform === "win32") {
    return resolve(process.env.APPDATA || resolve(homedir(), "AppData", "Roaming"), "donixrouter");
  }
  if (process.platform === "darwin") {
    return resolve(homedir(), "Library", "Application Support", "donixrouter");
  }
  return resolve(process.env.XDG_DATA_HOME || resolve(homedir(), ".local", "share"), "donixrouter");
}

function getCookieFile() {
  return resolve(getDataDir(), "cookies.json");
}

export class CookieJar {
  constructor() {
    /** @type {Map<string, Record<string, { value: string, expires: number|null }>>} */
    this._cookies = new Map();
    this._persistTimer = null;
    this._load();
    this._cleanupExpired();
    this._cleanupInterval = setInterval(() => this._cleanupExpired(), 5 * 60 * 1000);
    if (this._cleanupInterval.unref) this._cleanupInterval.unref();
  }

  /**
   * Set cookies for an account.
   * @param {string} accountId
   * @param {string|object} cookies - "name1=val1; name2=val2" or Record<string, string>
   */
  set(accountId, cookies) {
    const existing = this._cookies.get(accountId) || {};
    let hasCritical = false;

    if (typeof cookies === "string") {
      for (const pair of cookies.split(";")) {
        const [name, ...rest] = pair.split("=");
        const trimmedName = name?.trim();
        if (!trimmedName) continue;
        const value = rest.join("=").trim();
        existing[trimmedName] = { value, expires: null };
        if (CRITICAL_COOKIES.has(trimmedName)) hasCritical = true;
      }
    } else if (cookies && typeof cookies === "object") {
      for (const [name, value] of Object.entries(cookies)) {
        existing[name] = { value: String(value), expires: null };
        if (CRITICAL_COOKIES.has(name)) hasCritical = true;
      }
    }

    this._cookies.set(accountId, existing);
    if (hasCritical) {
      this._persistNow();
    } else {
      this._schedulePersist();
    }
  }

  /**
   * Capture raw Set-Cookie headers from an HTTP response.
   * @param {string} accountId
   * @param {string[]} setCookieHeaders
   */
  captureRaw(accountId, setCookieHeaders) {
    if (!setCookieHeaders || setCookieHeaders.length === 0) return;
    const existing = this._cookies.get(accountId) || {};
    let hasCritical = false;

    for (const header of setCookieHeaders) {
      const parts = header.split(";");
      const nameVal = parts[0];
      if (!nameVal) continue;
      const eqIdx = nameVal.indexOf("=");
      if (eqIdx < 0) continue;
      const name = nameVal.slice(0, eqIdx).trim();
      const value = nameVal.slice(eqIdx + 1).trim();
      if (!name) continue;

      // Parse expires/max-age
      let expires = null;
      for (const attr of parts.slice(1)) {
        const lower = attr.trim().toLowerCase();
        if (lower.startsWith("expires=")) {
          const date = new Date(attr.trim().slice(8));
          if (!isNaN(date.getTime())) expires = date.getTime();
        } else if (lower.startsWith("max-age=")) {
          const sec = parseInt(lower.slice(8), 10);
          if (sec > 0) expires = Date.now() + sec * 1000;
        }
      }

      existing[name] = { value, expires };
      if (CRITICAL_COOKIES.has(name)) hasCritical = true;
    }

    this._cookies.set(accountId, existing);
    if (hasCritical) {
      this._persistNow();
    } else {
      this._schedulePersist();
    }
  }

  /**
   * Build a Cookie header string for an account.
   * @param {string} accountId
   * @returns {string|null}
   */
  getCookieHeader(accountId) {
    const cookies = this._cookies.get(accountId);
    if (!cookies) return null;
    const now = Date.now();
    const pairs = [];
    for (const [name, { value, expires }] of Object.entries(cookies)) {
      if (expires && expires < now) continue;
      pairs.push(`${name}=${value}`);
    }
    return pairs.length > 0 ? pairs.join("; ") : null;
  }

  /**
   * Clear cookies for an account.
   * @param {string} accountId
   */
  clear(accountId) {
    this._cookies.delete(accountId);
    this._schedulePersist();
  }

  dispose() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    this._persistNow();
  }

  // ── Private ──────────────────────────────────────────────

  _load() {
    try {
      const file = getCookieFile();
      if (!existsSync(file)) return;
      const raw = JSON.parse(readFileSync(file, "utf-8"));
      if (raw._version === 2 && raw.accounts) {
        for (const [acctId, cookies] of Object.entries(raw.accounts)) {
          this._cookies.set(acctId, cookies);
        }
      } else if (typeof raw === "object" && !raw._version) {
        // v1 format: flat accountId → { name: value }
        for (const [acctId, cookies] of Object.entries(raw)) {
          if (typeof cookies === "object") {
            const upgraded = {};
            for (const [name, value] of Object.entries(cookies)) {
              upgraded[name] = { value: String(value), expires: null };
            }
            this._cookies.set(acctId, upgraded);
          }
        }
      }
    } catch { /* ignore load errors */ }
  }

  _persistNow() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    try {
      const file = getCookieFile();
      const dir = dirname(file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const data = { _version: 2, accounts: {} };
      for (const [acctId, cookies] of this._cookies) {
        data.accounts[acctId] = cookies;
      }
      writeFileSync(file, JSON.stringify(data), "utf-8");
    } catch { /* persist failures are non-fatal */ }
  }

  _schedulePersist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persistNow();
    }, 2000);
    if (this._persistTimer.unref) this._persistTimer.unref();
  }

  _cleanupExpired() {
    const now = Date.now();
    for (const [acctId, cookies] of this._cookies) {
      let changed = false;
      for (const [name, entry] of Object.entries(cookies)) {
        if (entry.expires && entry.expires < now) {
          delete cookies[name];
          changed = true;
        }
      }
      if (changed && Object.keys(cookies).length === 0) {
        this._cookies.delete(acctId);
      }
    }
  }
}

/** Singleton */
let _instance = null;

export function getCookieJar() {
  if (!_instance) _instance = new CookieJar();
  return _instance;
}

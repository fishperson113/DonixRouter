/**
 * Fingerprint manager — builds headers that mimic the Codex Desktop client.
 * Adapted from codex-proxy's fingerprint/manager.ts.
 *
 * Reads fingerprint.yaml + default.yaml config to produce properly ordered
 * headers with sec-ch-ua, sec-fetch-*, User-Agent matching real Codex CLI.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config loading ────────────────────────────────────────────────

let _config = null;
let _fingerprint = null;

function findConfigDir() {
  // Walk up from open-sse/utils/ to find the config/ directory
  let dir = resolve(__dirname, "..", "..");
  for (let i = 0; i < 5; i++) {
    const configDir = resolve(dir, "config");
    if (existsSync(resolve(configDir, "fingerprint.yaml"))) return configDir;
    dir = resolve(dir, "..");
  }
  return null;
}

function parseYaml(text) {
  // Minimal YAML parser for flat + nested key-value configs
  const result = {};
  let currentSection = null;
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("#") || line.trim() === "") continue;
    const sectionMatch = line.match(/^(\w[\w_-]*):\s*$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      result[currentSection] = {};
      continue;
    }
    const listMatch = line.match(/^\s+-\s+"(.+)"$/);
    if (listMatch && currentSection) {
      if (!Array.isArray(result[currentSection])) result[currentSection] = [];
      result[currentSection].push(listMatch[1]);
      continue;
    }
    const kvMatch = line.match(/^\s+([\w-]+):\s*(.+)$/);
    if (kvMatch && currentSection) {
      let val = kvMatch[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (typeof result[currentSection] === "object" && !Array.isArray(result[currentSection])) {
        result[currentSection][kvMatch[1]] = val;
      }
      continue;
    }
    const topKvMatch = line.match(/^(\w[\w_-]*):\s+(.+)$/);
    if (topKvMatch && !currentSection) {
      let val = topKvMatch[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[topKvMatch[1]] = val;
    }
  }
  return result;
}

function loadConfig() {
  if (_config) return _config;
  const configDir = findConfigDir();
  if (!configDir) {
    _config = {
      client: { originator: "codex-cli", app_version: "1.0.18", platform: "macOS", arch: "arm64", chromium_version: "144" }
    };
    return _config;
  }
  try {
    const text = readFileSync(resolve(configDir, "default.yaml"), "utf-8");
    const raw = parseYaml(text);
    _config = {
      client: {
        originator: raw.client?.originator || "Codex Desktop",
        app_version: raw.client?.app_version || "26.318.11754",
        platform: raw.client?.platform || "darwin",
        arch: raw.client?.arch || "arm64",
        chromium_version: raw.client?.chromium_version || "144",
      }
    };
  } catch {
    _config = {
      client: { originator: "Codex Desktop", app_version: "26.318.11754", platform: "darwin", arch: "arm64", chromium_version: "144" }
    };
  }
  return _config;
}

function loadFingerprint() {
  if (_fingerprint) return _fingerprint;
  const configDir = findConfigDir();
  if (!configDir) {
    _fingerprint = { user_agent_template: "codex-cli/{version} ({platform}; {arch})", header_order: [], default_headers: {} };
    return _fingerprint;
  }
  try {
    const text = readFileSync(resolve(configDir, "fingerprint.yaml"), "utf-8");
    const raw = parseYaml(text);
    _fingerprint = {
      user_agent_template: raw.user_agent_template || "Codex Desktop/{version} ({platform}; {arch})",
      header_order: Array.isArray(raw.header_order) ? raw.header_order : [],
      default_headers: typeof raw.default_headers === "object" && !Array.isArray(raw.default_headers)
        ? raw.default_headers : {},
    };
  } catch {
    _fingerprint = { user_agent_template: "Codex Desktop/{version} ({platform}; {arch})", header_order: [], default_headers: {} };
  }
  return _fingerprint;
}

// ── Header building ───────────────────────────────────────────────

function orderHeaders(headers, order) {
  const ordered = {};
  for (const key of order) {
    if (key in headers) ordered[key] = headers[key];
  }
  for (const key of Object.keys(headers)) {
    if (!(key in ordered)) ordered[key] = headers[key];
  }
  return ordered;
}

function buildSecChUa(config) {
  const cv = config.client.chromium_version;
  return `"Chromium";v="${cv}", "Not:A-Brand";v="24"`;
}

function buildUserAgent(config, fp) {
  return fp.user_agent_template
    .replace("{version}", config.client.app_version)
    .replace("{platform}", config.client.platform)
    .replace("{arch}", config.client.arch);
}

function buildRawDefaultHeaders(config, fp) {
  const raw = {};
  raw["User-Agent"] = buildUserAgent(config, fp);
  raw["sec-ch-ua"] = buildSecChUa(config);
  if (fp.default_headers) {
    for (const [key, value] of Object.entries(fp.default_headers)) {
      raw[key] = value;
    }
  }
  return raw;
}

/**
 * Build full authenticated headers with fingerprint + ordering.
 * @param {string} token - Bearer token
 * @param {string|null} [accountId] - ChatGPT account ID
 * @returns {object} Ordered headers
 */
export function buildFingerprintHeaders(token, accountId) {
  const config = loadConfig();
  const fp = loadFingerprint();
  const raw = {};

  raw["Authorization"] = `Bearer ${token}`;
  if (accountId) raw["ChatGPT-Account-Id"] = accountId;
  raw["originator"] = config.client.originator;

  const defaults = buildRawDefaultHeaders(config, fp);
  for (const [key, value] of Object.entries(defaults)) {
    raw[key] = value;
  }

  return orderHeaders(raw, fp.header_order);
}

/**
 * Build authenticated headers with Content-Type included.
 * @param {string} token
 * @param {string|null} [accountId]
 * @returns {object}
 */
export function buildFingerprintHeadersWithContentType(token, accountId) {
  const headers = buildFingerprintHeaders(token, accountId);
  const fp = loadFingerprint();
  headers["Content-Type"] = "application/json";
  return orderHeaders(headers, fp.header_order);
}

/**
 * Build anonymous headers (no auth) for OAuth/public endpoints.
 * @returns {object}
 */
export function buildAnonymousHeaders() {
  const config = loadConfig();
  const fp = loadFingerprint();
  const raw = buildRawDefaultHeaders(config, fp);
  return orderHeaders(raw, fp.header_order);
}

/**
 * Get the loaded config for external use.
 * @returns {{ client: object }}
 */
export function getClientConfig() {
  return loadConfig();
}

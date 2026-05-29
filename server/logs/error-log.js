/**
 * Local uncaught-error log.
 *
 * Appends sanitized error records to `data/error-log.jsonl`, rotating
 * at a configurable byte cap (single backup file, `error-log.1.jsonl`).
 * A sidecar `error-log.cursor` tracks the last "seen" timestamp so the
 * dashboard can surface an unread count.
 *
 * JavaScript port of codex-proxy-dev/src/logs/error-log.ts
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { resolve } from "path";
import { DATA_DIR } from "#lib/dataDir.js";

const LOG_FILE = "error-log.jsonl";
const BACKUP_FILE = "error-log.1.jsonl";
const CURSOR_FILE = "error-log.cursor";
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  return DATA_DIR;
}

function logPath() { return resolve(ensureDataDir(), LOG_FILE); }
function backupPath() { return resolve(ensureDataDir(), BACKUP_FILE); }
function cursorPath() { return resolve(ensureDataDir(), CURSOR_FILE); }

/** Rotate error-log.jsonl → error-log.1.jsonl if current size exceeds the cap. */
function rotateIfNeeded(maxBytes) {
  const current = logPath();
  if (!existsSync(current)) return;
  const size = statSync(current).size;
  if (size <= maxBytes) return;
  const backup = backupPath();
  if (existsSync(backup) && process.platform === "win32") {
    try { writeFileSync(backup, ""); } catch { /* fall through */ }
  }
  renameSync(current, backup);
}

/**
 * Redact sensitive values from context before writing to disk.
 * Scrubs: authorization tokens, cookies, OAuth state, API keys.
 */
function redactValue(key, value) {
  if (typeof value !== "string") return value;
  const lowerKey = key.toLowerCase();
  if (lowerKey.includes("token") || lowerKey.includes("authorization") ||
      lowerKey.includes("cookie") || lowerKey.includes("secret") ||
      lowerKey.includes("apikey") || lowerKey.includes("api_key")) {
    return value.length > 8 ? value.slice(0, 4) + "…" + value.slice(-4) : "[REDACTED]";
  }
  return value;
}

function redactJson(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactJson(v));
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "object" && value !== null) {
      result[key] = redactJson(value);
    } else {
      result[key] = redactValue(key, value);
    }
  }
  return result;
}

/**
 * Append an error record to the log.
 * Silently no-ops when the write fails (logging must never break the caller).
 */
export function appendErrorLog(input) {
  const sanitizedContext = input.context !== undefined ? redactJson(input.context) : undefined;

  const entry = {
    ts: new Date().toISOString(),
    version: "1.0.0",
    platform: process.platform,
    source: input.source,
    error: {
      name: input.error.name,
      message: input.error.message,
      stack: input.error.stack,
    },
    ...(sanitizedContext !== undefined ? { context: sanitizedContext } : {}),
  };

  try {
    rotateIfNeeded(DEFAULT_MAX_BYTES);
    appendFileSync(logPath(), JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // Logging failures must never throw.
  }
}

function readJsonlFile(path) {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  const out = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { out.push(JSON.parse(trimmed)); } catch { /* skip corrupted lines */ }
  }
  return out;
}

/**
 * Read entries from current + backup files, newest first.
 * `limit`, when given, caps the number of returned entries.
 */
export function readErrorLog(limit) {
  const oldest = readJsonlFile(backupPath());
  const newest = readJsonlFile(logPath());
  const combined = [...oldest, ...newest];
  combined.reverse();
  if (limit !== undefined) return combined.slice(0, limit);
  return combined;
}

function firstStackFrame(stack) {
  if (!stack) return "";
  for (const line of stack.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/**
 * Group entries by signature (name + first stack frame).
 * Returned groups are ordered by last_seen descending.
 */
export function groupErrorLog(entries) {
  const groups = new Map();
  for (const e of entries) {
    const sig = `${e.error.name}|${firstStackFrame(e.error.stack)}`;
    const existing = groups.get(sig);
    if (existing) {
      existing.count += 1;
      if (e.ts > existing.last_seen) {
        existing.last_seen = e.ts;
        existing.message = e.error.message;
        existing.source = e.source;
        existing.sample_stack = e.error.stack;
        existing.sample_context = e.context;
      }
      if (e.ts < existing.first_seen) existing.first_seen = e.ts;
    } else {
      groups.set(sig, {
        signature: sig,
        name: e.error.name,
        message: e.error.message,
        count: 1,
        first_seen: e.ts,
        last_seen: e.ts,
        source: e.source,
        sample_stack: e.error.stack,
        sample_context: e.context,
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) =>
    a.last_seen < b.last_seen ? 1 : a.last_seen > b.last_seen ? -1 : 0,
  );
}

/** Last-read timestamp from the cursor file; null if no cursor exists. */
export function getReadCursor() {
  const path = cursorPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8").trim();
    return raw || null;
  } catch {
    return null;
  }
}

/** Persist the read cursor. */
export function setReadCursor(ts) {
  try {
    writeFileSync(cursorPath(), ts, "utf-8");
  } catch { /* non-critical */ }
}

/** Count entries strictly newer than the read cursor. */
export function getUnreadCount(entries) {
  const cursor = getReadCursor();
  const list = entries ?? readErrorLog();
  if (cursor === null) return list.length;
  let count = 0;
  for (const e of list) {
    if (e.ts > cursor) count += 1;
  }
  return count;
}

// ── Process-level handlers ──────────────────────────────────────────

function asError(value) {
  if (value instanceof Error) {
    return { name: value.name || "Error", message: value.message, stack: value.stack };
  }
  if (typeof value === "string") return { name: "Error", message: value };
  try { return { name: "Error", message: JSON.stringify(value) }; } catch { return { name: "Error", message: String(value) }; }
}

export function handleUncaughtException(err, source = "main") {
  appendErrorLog({ source, error: asError(err) });
}

export function handleUnhandledRejection(reason, source = "main") {
  appendErrorLog({ source, error: asError(reason) });
}

let _handlersInstalled = false;

/**
 * Register process-wide uncaught handlers that funnel into the local error log.
 * Idempotent — safe to call multiple times.
 */
export function installUncaughtErrorHandlers(source = "main") {
  if (_handlersInstalled) return;
  _handlersInstalled = true;
  process.on("uncaughtException", (err) => {
    handleUncaughtException(err, source);
    console.error(`[UNCAUGHT] ${err.stack || err.message || err}`);
  });
  process.on("unhandledRejection", (reason) => {
    handleUnhandledRejection(reason, source);
  });
}

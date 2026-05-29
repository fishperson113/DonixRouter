/**
 * Installation ID — stable per-installation UUID sent to upstream as both
 * `x-codex-installation-id` HTTP header and inside the request body's
 * `client_metadata` map. Adapted from codex-proxy's installation-id.ts.
 *
 * Real Codex CLI uses this as a routing/affinity hint so the upstream LB
 * can pin a single client to the same backend instance, keeping the
 * prompt cache warm across turns.
 *
 * Lookup order:
 *   1. `~/.codex/installation_id` if it exists and parses as a UUID
 *   2. `<dataDir>/installation_id` if previously persisted
 *   3. Generate a new UUID, persist to `<dataDir>/installation_id`
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let _cached = null;

function readUuidFile(path) {
  try {
    if (!existsSync(path)) return null;
    const trimmed = readFileSync(path, "utf-8").trim();
    return UUID_RE.test(trimmed) ? trimmed : null;
  } catch {
    return null;
  }
}

function persistUuid(path, uuid) {
  try {
    const dir = resolve(path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, uuid, "utf-8");
  } catch (err) {
    console.warn(`[InstallationId] Failed to persist to ${path}:`, err?.message || err);
  }
}

function getDataDir() {
  // Use platform-appropriate data dir
  if (process.platform === "win32") {
    return resolve(process.env.APPDATA || resolve(homedir(), "AppData", "Roaming"), "donixrouter");
  }
  if (process.platform === "darwin") {
    return resolve(homedir(), "Library", "Application Support", "donixrouter");
  }
  return resolve(process.env.XDG_DATA_HOME || resolve(homedir(), ".local", "share"), "donixrouter");
}

export function getInstallationId() {
  if (_cached) return _cached;

  // 1. Try ~/.codex/installation_id (real Codex CLI install)
  const codexHome = resolve(homedir(), ".codex", "installation_id");
  const fromCodex = readUuidFile(codexHome);
  if (fromCodex) {
    _cached = fromCodex;
    return fromCodex;
  }

  // 2. Try our own data dir
  const ourFile = resolve(getDataDir(), "installation_id");
  const fromOurs = readUuidFile(ourFile);
  if (fromOurs) {
    _cached = fromOurs;
    return fromOurs;
  }

  // 3. Generate and persist
  const generated = randomUUID();
  persistUuid(ourFile, generated);
  _cached = generated;
  return generated;
}

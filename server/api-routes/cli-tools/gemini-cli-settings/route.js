"use server";

import { NextResponse } from "#adapter/nextShim.js";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const DEFAULT_API_VERSION = "v1beta";
const MANAGED_ENV_KEYS = [
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_API_KEY_AUTH_MECHANISM",
  "GOOGLE_GEMINI_BASE_URL",
  "GOOGLE_GENAI_API_VERSION",
];

const getGeminiDir = () => path.join(os.homedir(), ".gemini");
const getGeminiSettingsPath = () => path.join(getGeminiDir(), "settings.json");
const getGeminiEnvPath = () => path.join(getGeminiDir(), ".env");

const stripTrailingSlash = (value = "") => String(value || "").replace(/\/+$/, "");

const isGoogleHostedGeminiUrl = (value = "") =>
  /https?:\/\/(?:generativelanguage|aiplatform)\.googleapis\.com/i.test(String(value || ""));

const isManagedBaseUrl = (value = "") => {
  const normalized = stripTrailingSlash(value);
  return !!normalized && !isGoogleHostedGeminiUrl(normalized);
};

const upsertEnvVar = (envText, key, value) => {
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  if (re.test(envText)) return envText.replace(re, line);
  return envText.length > 0 && !envText.endsWith("\n") ? `${envText}\n${line}\n` : `${envText}${line}\n`;
};

const removeEnvVar = (envText, key) => {
  const re = new RegExp(`^${key}=.*\\r?\\n?`, "m");
  return envText.replace(re, "");
};

const unwrapEnvValue = (value = "") => {
  const trimmed = String(value || "").trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseEnvFile = (envText = "") => {
  const result = {};
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    result[match[1]] = unwrapEnvValue(match[2]);
  }
  return result;
};

const cleanupEmptyObjects = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  Object.keys(value).forEach((key) => {
    cleanupEmptyObjects(value[key]);
    if (
      value[key] &&
      typeof value[key] === "object" &&
      !Array.isArray(value[key]) &&
      Object.keys(value[key]).length === 0
    ) {
      delete value[key];
    }
  });
  return value;
};

const checkGeminiInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where gemini" : "which gemini";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await Promise.any([
        fs.access(getGeminiSettingsPath()),
        fs.access(getGeminiEnvPath()),
      ]);
      return true;
    } catch {
      return false;
    }
  }
};

const readSettings = async () => {
  try {
    const content = await fs.readFile(getGeminiSettingsPath(), "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

const readEnvFile = async () => {
  try {
    return await fs.readFile(getGeminiEnvPath(), "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
};

export async function GET() {
  try {
    const installed = await checkGeminiInstalled();

    if (!installed) {
      return NextResponse.json({
        installed: false,
        settings: null,
        env: null,
        message: "Gemini CLI is not installed",
      });
    }

    const [settings, envText] = await Promise.all([readSettings(), readEnvFile()]);
    const env = parseEnvFile(envText);
    const currentBaseUrl = stripTrailingSlash(env.GOOGLE_GEMINI_BASE_URL || "");
    const currentModel = settings?.model?.name || env.GEMINI_MODEL || null;
    const selectedType = settings?.security?.auth?.selectedType || null;

    return NextResponse.json({
      installed: true,
      settings,
      env: {
        GEMINI_MODEL: env.GEMINI_MODEL || null,
        GOOGLE_GEMINI_BASE_URL: currentBaseUrl || null,
        GOOGLE_GENAI_API_VERSION: env.GOOGLE_GENAI_API_VERSION || null,
      },
      hasDonixRouter: isManagedBaseUrl(currentBaseUrl),
      settingsPath: getGeminiSettingsPath(),
      envPath: getGeminiEnvPath(),
      gemini: {
        currentBaseUrl: currentBaseUrl || null,
        currentModel,
        selectedType,
        apiVersion: env.GOOGLE_GENAI_API_VERSION || null,
      },
    });
  } catch (error) {
    console.log("Error checking Gemini CLI settings:", error);
    return NextResponse.json({ error: "Failed to check Gemini CLI settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, model } = await request.json();

    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json({ error: "baseUrl, apiKey and model are required" }, { status: 400 });
    }

    const geminiDir = getGeminiDir();
    await fs.mkdir(geminiDir, { recursive: true });

    let settings = {};
    try {
      settings = JSON.parse(await fs.readFile(getGeminiSettingsPath(), "utf-8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    settings.model = {
      ...(settings.model || {}),
      name: model,
    };
    settings.advanced = {
      ...(settings.advanced || {}),
      ignoreLocalEnv: true,
    };
    settings.security = {
      ...(settings.security || {}),
      auth: {
        ...(settings.security?.auth || {}),
        selectedType: "gemini-api-key",
      },
    };

    await fs.writeFile(getGeminiSettingsPath(), JSON.stringify(settings, null, 2));

    const normalizedBaseUrl = stripTrailingSlash(baseUrl);
    let envText = await readEnvFile();
    envText = upsertEnvVar(envText, "GEMINI_API_KEY", apiKey);
    envText = upsertEnvVar(envText, "GEMINI_MODEL", model);
    envText = upsertEnvVar(envText, "GEMINI_API_KEY_AUTH_MECHANISM", "bearer");
    envText = upsertEnvVar(envText, "GOOGLE_GEMINI_BASE_URL", normalizedBaseUrl);
    envText = upsertEnvVar(envText, "GOOGLE_GENAI_API_VERSION", DEFAULT_API_VERSION);
    await fs.writeFile(getGeminiEnvPath(), envText);

    return NextResponse.json({
      success: true,
      message: "Gemini CLI settings applied successfully!",
      settingsPath: getGeminiSettingsPath(),
      envPath: getGeminiEnvPath(),
    });
  } catch (error) {
    console.log("Error updating Gemini CLI settings:", error);
    return NextResponse.json({ error: "Failed to update Gemini CLI settings" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    let settings = null;
    let envText = "";
    let hadSettingsFile = false;
    let hadEnvFile = false;

    try {
      settings = JSON.parse(await fs.readFile(getGeminiSettingsPath(), "utf-8"));
      hadSettingsFile = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    try {
      envText = await fs.readFile(getGeminiEnvPath(), "utf-8");
      hadEnvFile = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    const env = parseEnvFile(envText);
    const currentBaseUrl = stripTrailingSlash(env.GOOGLE_GEMINI_BASE_URL || "");
    const currentModel = settings?.model?.name || env.GEMINI_MODEL || "";
    const shouldClearModel =
      !!currentModel &&
      (currentModel.includes("/") || (!!env.GEMINI_MODEL && currentModel === env.GEMINI_MODEL) || isManagedBaseUrl(currentBaseUrl));

    MANAGED_ENV_KEYS.forEach((key) => {
      envText = removeEnvVar(envText, key);
    });
    if (hadEnvFile) {
      await fs.writeFile(getGeminiEnvPath(), envText);
    }

    if (hadSettingsFile && settings) {
      if (shouldClearModel && settings.model?.name) {
        delete settings.model.name;
      }

      if (settings.advanced?.ignoreLocalEnv === true && (shouldClearModel || isManagedBaseUrl(currentBaseUrl))) {
        delete settings.advanced.ignoreLocalEnv;
      }

      if (settings.security?.auth?.selectedType === "gemini-api-key" && (shouldClearModel || isManagedBaseUrl(currentBaseUrl))) {
        delete settings.security.auth.selectedType;
      }

      cleanupEmptyObjects(settings);
      await fs.writeFile(getGeminiSettingsPath(), JSON.stringify(settings, null, 2));
    }

    return NextResponse.json({
      success: true,
      message: "Gemini CLI settings reset successfully!",
    });
  } catch (error) {
    console.log("Error resetting Gemini CLI settings:", error);
    return NextResponse.json({ error: "Failed to reset Gemini CLI settings" }, { status: 500 });
  }
}

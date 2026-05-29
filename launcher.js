#!/usr/bin/env node
/**
 * DonixRouter Launcher — Interactive CLI menu
 *
 * Usage:
 *   node launcher.js                  Menu (server gắn với cmd này — đóng cmd = tắt server)
 *   node launcher.js --headless       Chạy thẳng server foreground (không menu)
 *   node launcher.js --tray | -b      Spawn server detached rồi thoát (chạy nền vĩnh viễn)
 *   node launcher.js --open           Start + mở trình duyệt (attached)
 */

import { spawn } from "child_process";
import { createInterface } from "readline";
import { networkInterfaces } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = (() => {
  try { return JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")).version; }
  catch { return "1.0.0"; }
})();
const PORT = parseInt(process.env.PORT || "20128", 10);
const SERVER_PATH = join(__dirname, "server", "index.js");
const PID_FILE = join(__dirname, ".donixrouter.pid");
const IS_WIN = process.platform === "win32";

const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m",
  red: "\x1b[31m", white: "\x1b[97m",
};

function getLocalIP() {
  try {
    for (const list of Object.values(networkInterfaces())) {
      for (const net of list || []) {
        if (net.family === "IPv4" && !net.internal) return net.address;
      }
    }
  } catch { /* ignore */ }
  return "127.0.0.1";
}

function printBanner() {
  console.clear();
  console.log(`
${c.cyan}${c.bold}  ╔══════════════════════════════════════════╗
  ║         ${c.white}DonixRouter${c.cyan}  v${VERSION}            ║
  ╚══════════════════════════════════════════╝${c.reset}

  ${c.dim}Local:   ${c.reset}http://localhost:${PORT}
  ${c.dim}Network: ${c.reset}http://${getLocalIP()}:${PORT}
`);
}

// ── Lifecycle ────────────────────────────────────────────────
let attachedChild = null;
let cleaningUp = false;

function spawnAttached({ silent = false } = {}) {
  // detached:false → cùng process-group với cmd này.
  // Trên Windows: console-close event lan tới child → child cũng tắt.
  // Trên *nix: SIGHUP khi terminal đóng + signal handlers ở dưới.
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: silent ? "ignore" : "inherit",
    detached: false,
    windowsHide: false,
  });
  attachedChild = child;
  child.on("exit", (code) => {
    if (attachedChild === child) attachedChild = null;
    if (!cleaningUp) {
      console.log(`\n  ${c.dim}Server exited (code ${code ?? "?"})${c.reset}`);
      process.exit(code ?? 0);
    }
  });
  return child;
}

function spawnDetached() {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });
  child.unref();
  try { writeFileSync(PID_FILE, String(child.pid)); } catch { /* ignore */ }
  return child;
}

function killAttached() {
  if (!attachedChild) return;
  cleaningUp = true;
  const pid = attachedChild.pid;
  try { attachedChild.kill("SIGTERM"); } catch { /* ignore */ }
  setTimeout(() => {
    try {
      if (IS_WIN) {
        spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }).unref();
      } else {
        try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
      }
    } catch { /* ignore */ }
  }, 2500).unref();
}

function registerCleanup() {
  const onSignal = () => {
    killAttached();
    setTimeout(() => process.exit(0), 200).unref();
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    try { process.on(sig, onSignal); } catch { /* not supported */ }
  }
  process.on("exit", () => { try { killAttached(); } catch { /* ignore */ } });
  process.on("uncaughtException", (e) => {
    console.error(e);
    killAttached();
    setTimeout(() => process.exit(1), 200).unref();
  });
}

// ── Helpers ──────────────────────────────────────────────────
async function isServerRunning() {
  try {
    const resp = await fetch(`http://localhost:${PORT}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return resp.ok;
  } catch { return false; }
}

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerRunning()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function openBrowser(path = "") {
  const url = `http://localhost:${PORT}${path}`;
  console.log(`\n  ${c.green}→ Opening ${url}${c.reset}\n`);
  try {
    const open = (await import("open")).default;
    await open(url);
  } catch {
    const cmd = IS_WIN ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
    spawn(cmd, [url], { shell: true, detached: true, stdio: "ignore" }).unref();
  }
}

// ── Menu ─────────────────────────────────────────────────────
function printMenu() {
  const items = [
    { key: "1", icon: "🌐", label: "Open Web UI",        desc: "browser" },
    { key: "2", icon: "📊", label: "Quota Widget",       desc: "compact view" },
    { key: "3", icon: "📜", label: "Show Server Logs",   desc: "restart attached, log to this terminal" },
    { key: "4", icon: "🔽", label: "Hide to Background", desc: "detach server, exit launcher" },
    { key: "5", icon: "❌", label: "Stop & Exit",         desc: "kills server too" },
  ];
  console.log(`${c.bold}  Select an option:${c.reset}\n`);
  for (const it of items) {
    console.log(`    ${c.cyan}${it.key}${c.reset}  ${it.icon}  ${c.bold}${it.label}${c.reset}  ${c.dim}(${it.desc})${c.reset}`);
  }
  console.log();
}

async function showMenu() {
  registerCleanup();
  printBanner();

  let externalServer = false;
  if (await isServerRunning()) {
    externalServer = true;
    console.log(`  ${c.green}● Server is already running on port ${PORT}${c.reset}`);
    console.log(`  ${c.dim}(started outside this launcher — Stop & Exit will not kill it)${c.reset}\n`);
  } else {
    console.log(`  ${c.dim}Starting server (tied to this terminal)...${c.reset}`);
    spawnAttached({ silent: true });
    if (!(await waitForServer())) {
      console.log(`  ${c.red}✗ Server failed to start within 20s${c.reset}\n`);
      killAttached();
      process.exit(1);
    }
    console.log(`  ${c.green}● Server ready${c.reset}\n`);
  }

  printMenu();
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question(`  ${c.cyan}>${c.reset} `, async (answer) => {
      const choice = answer.trim().toLowerCase();
      switch (choice) {
        case "1":
          await openBrowser();
          ask();
          break;
        case "2":
          await openBrowser("/quota-widget");
          ask();
          break;
        case "3":
          rl.close();
          if (externalServer) {
            console.log(`\n  ${c.yellow}Cannot show logs of an externally-started server.${c.reset}\n`);
            process.exit(0);
            break;
          }
          killAttached();
          await new Promise((r) => setTimeout(r, 800));
          cleaningUp = false;
          console.log(`\n  ${c.green}→ Restarting server in foreground (Ctrl+C to stop)...${c.reset}\n`);
          spawnAttached({ silent: false });
          break;
        case "4": {
          rl.close();
          if (!externalServer) {
            killAttached();
            await new Promise((r) => setTimeout(r, 800));
          }
          const det = spawnDetached();
          const ok = await waitForServer();
          attachedChild = null; // don't kill the detached one on exit
          if (ok) {
            console.log(`\n  ${c.green}✓ Server detached (PID ${det.pid})${c.reset}`);
            console.log(`  ${c.dim}URL:  http://localhost:${PORT}${c.reset}`);
            console.log(`  ${c.dim}Stop: ${IS_WIN ? `taskkill /PID ${det.pid} /F` : `kill ${det.pid}`}${c.reset}\n`);
          } else {
            console.log(`\n  ${c.red}✗ Detached server did not respond on /api/health${c.reset}\n`);
          }
          process.exit(0);
          break;
        }
        case "5":
        case "q":
        case "exit":
          rl.close();
          console.log(`\n  ${c.dim}Stopping server and exiting...${c.reset}\n`);
          killAttached();
          setTimeout(() => process.exit(0), 800).unref();
          break;
        default:
          console.log(`  ${c.red}Invalid option. Choose 1-5.${c.reset}\n`);
          ask();
      }
    });
  };
  ask();
}

// ── CLI args ─────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes("--tray") || args.includes("--background") || args.includes("-b")) {
  printBanner();
  if (await isServerRunning()) {
    console.log(`  ${c.green}● Server already running on port ${PORT}${c.reset}\n`);
  } else {
    const det = spawnDetached();
    if (await waitForServer()) {
      console.log(`  ${c.green}✓ Server detached (PID ${det.pid})${c.reset}`);
      console.log(`  ${c.dim}Stop: ${IS_WIN ? `taskkill /PID ${det.pid} /F` : `kill ${det.pid}`}${c.reset}\n`);
    } else {
      console.log(`  ${c.red}✗ Server failed to start${c.reset}\n`);
      process.exit(1);
    }
  }
  process.exit(0);
} else if (args.includes("--headless") || args.includes("--no-menu")) {
  registerCleanup();
  printBanner();
  spawnAttached({ silent: false });
} else if (args.includes("--open")) {
  registerCleanup();
  printBanner();
  if (!(await isServerRunning())) {
    spawnAttached({ silent: true });
    if (!(await waitForServer())) {
      console.log(`  ${c.red}✗ Server failed to start${c.reset}`);
      killAttached();
      process.exit(1);
    }
  }
  await openBrowser();
} else {
  showMenu();
}

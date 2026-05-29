<div align="center">

<img src="./images/logo.png" alt="DonixRouter" width="110"/>

# DonixRouter

### Local AI Gateway — Provider Orchestration, Smart Routing & OpenAI‑Compatible API

**One local endpoint. Many providers. Zero vendor lock‑in.**
Connect Claude Code, Codex, Gemini CLI, Cursor, Cline, Copilot, OpenCode and any OpenAI‑compatible AI tool to a single dashboard that talks to every provider for you.

---

[![Node.js 22](https://img.shields.io/badge/runtime-Node.js%2022%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Hono](https://img.shields.io/badge/backend-Hono-E36002?style=flat-square)](https://hono.dev)
[![React + Vite](https://img.shields.io/badge/frontend-React%20%2B%20Vite-61DAFB?style=flat-square&logo=react&logoColor=111827)](https://vitejs.dev)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI%20Compatible-111827?style=flat-square&logo=openai&logoColor=white)](https://platform.openai.com/docs)
[![License: MIT](https://img.shields.io/badge/license-MIT-2563EB?style=flat-square)](./LICENSE)

[**⚡ Quick Start**](#-quick-start) ·
[**🧭 How it works**](#-how-it-works) ·
[**🖥️ Dashboard**](#%EF%B8%8F-dashboard) ·
[**🔌 Tool Integration**](#-cli--coding-tool-integration) ·
[**⚙️ Configuration**](#%EF%B8%8F-configuration) ·
[**🔧 Troubleshooting**](#-troubleshooting) ·
[**🙏 Credits & Origins**](#-credits--project-origins)

</div>

---

## 🙏 Credits & Project Origins

> **DonixRouter is a re‑packaging and re‑distribution of work that already exists.**
> Every meaningful idea, route, and translation layer in this repository was first authored, debugged, and refined by other people. This project would not exist without them, and the goal of the credit table below is to make that visible — both to honour their work and to point users back to the original communities so they can star, fund, contribute to, and report bugs *upstream* whenever appropriate.

### Direct upstreams

| Upstream | Repository | What DonixRouter inherits |
|---|---|---|
| **9Router** | [github.com/decolua/9router](https://github.com/decolua/9router) | Project layout, dashboard direction, provider management surface, routing strategy concepts, the OpenAI‑compatible `/v1` API layer, and the broader "one local gateway in front of many providers" idea. |
| **codex-proxy** | [github.com/icebear0828/codex-proxy](https://github.com/icebear0828/codex-proxy) | Codex Desktop / ChatGPT Backend API compatibility, the Responses API endpoint, Codex‑specific request/response translation, streaming behaviour, the `/codex/*` URL rewrite flow, and the local TLS / fingerprint extraction tooling. |

### Ecosystems and protocols this project speaks to

DonixRouter only works because all of the following projects exist and document their wire formats. None of them are affiliated with this repo — please direct provider‑specific bug reports to them.

- **OpenAI** — Chat Completions / Responses / Embeddings / TTS / STT / Images APIs.
- **Anthropic Claude** — Messages API + tool use + streaming format.
- **Google Gemini** — `generateContent` / `streamGenerateContent` and Gemini CLI behaviour.
- **GitHub Copilot**, **Cursor**, **Cline**, **Continue**, **OpenCode**, **Opencode (kilo / hermes / cowork / antigravity / droid / openclaw)** — auth flows, settings file shapes, local socket conventions.
- **Hono** — the HTTP server framework powering the backend.
- **React, Vite, Tailwind CSS, Recharts, @xyflow/react, @monaco-editor/react** — the dashboard.
- **better-sqlite3 / sql.js** — local persistence.
- **MCP (Model Context Protocol)** and **A2A (Agent‑to‑Agent)** — the open standards used for the plugin/bridge layer.

### What is *not* original to this repo

- The provider list, model catalogue, routing strategies, dashboard pages and translation layers were all designed upstream. DonixRouter wires them together, ships a launcher, and standardises the project layout.
- The CLI integration helpers (auto‑edit `~/.codex/`, `~/.claude/`, `~/.gemini/`, etc.) follow conventions defined by each respective tool vendor.
- The TLS handshake fingerprint extraction approach and the Codex Desktop reverse‑proxy flow are upstream work from `codex-proxy`.

### License & attribution policy

- Source code is distributed under the **MIT License** — see [`LICENSE`](./LICENSE). The original copyright lines are preserved.
- If you fork or republish DonixRouter, please **keep this Credits section intact** and continue linking to the upstream repositories.
- Vendored pieces of upstream code retain their original headers; do not strip them.
- Trademarks (OpenAI, Claude, Gemini, Copilot, Cursor, Cline, etc.) belong to their respective owners. DonixRouter is an **independent compatibility layer** and is not endorsed by any of them.

> If you are an upstream author and would like attribution adjusted, removed, or reworded — please open an issue and it will be honoured immediately.

---

## ✨ What DonixRouter gives you

| Need | What you get |
|---|---|
| **One endpoint** | A local OpenAI‑compatible base URL (`http://localhost:20128/v1`) that every modern AI coding tool already knows how to talk to. |
| **Many providers** | OpenAI, Anthropic, Google, Codex Desktop, Cursor, Kiro, Copilot, plus dozens of OpenAI‑compatible providers behind a single config. |
| **Auto‑fallback** | If a provider rate‑limits, errors, or runs out of quota, the next eligible provider takes the request — your IDE never sees the failure. |
| **Format translation** | Bidirectional translation between OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and Gemini `generateContent`. |
| **Local‑first** | Everything runs on your machine. Tokens, API keys and prompts never leave your box. |
| **Dashboard** | A React/Vite UI to add accounts, monitor quotas, watch live logs, edit routing rules, and run translator tests. |
| **MITM helpers** | Optional MITM/proxy tools for Claude Code, Cursor, Cline, Copilot and similar agents that need a local TLS shim. |

---

## 🧭 How it works

```
                              ┌─────────────────────────────────────────┐
                              │              DonixRouter                │
                              │                                         │
 IDE / CLI tool ──HTTP──▶ /v1 │  ┌───────────────────────────────────┐  │
 (Claude Code, Codex,         │  │  Translation layer                │  │
  Gemini CLI, Cursor,         │  │  OpenAI ↔ Anthropic ↔ Gemini ↔    │  │
  Cline, Copilot, …)          │  │  Codex Responses                  │  │
                              │  └──────────────┬────────────────────┘  │
                              │                 ▼                       │
                              │  ┌───────────────────────────────────┐  │
                              │  │  Routing & fallback engine        │  │
                              │  │  account pool, retries, breakers  │  │
                              │  └──────────────┬────────────────────┘  │
                              │                 ▼                       │
                              │  ┌───────────────────────────────────┐  │
                              │  │  Provider adapters                │──┼──▶ OpenAI / Anthropic / Gemini /
                              │  │  + auth refresh, OAuth/PKCE       │  │    Codex Desktop / Cursor / Kiro /
                              │  └───────────────────────────────────┘  │    Copilot / OpenAI‑compatible …
                              │                                         │
                              │  ┌───────────────────────────────────┐  │
                              │  │  Dashboard (React + Vite)         │  │
                              │  │  served at  /                     │  │
                              │  └───────────────────────────────────┘  │
                              └─────────────────────────────────────────┘
```

**Three things to remember:**

1. Your IDE only ever sees `http://localhost:20128`. It never knows which provider answered.
2. The translator layer makes a Claude Code request acceptable to Gemini, a Codex Responses request acceptable to OpenAI Chat Completions, and so on.
3. The dashboard is the source of truth for accounts, routing rules, model catalogues and live logs.

---

## ⚡ Quick Start

### 1. Requirements

- **Node.js 22+** (LTS recommended) — `node --version`
- **npm 10+** — comes with Node 22
- Windows 10/11, macOS 13+, or any modern Linux

### 2. Install

```bash
git clone https://github.com/<your-fork>/DonixRouter.git
cd DonixRouter
npm run install:all          # installs root + server + web
```

`install:all` is equivalent to:

```bash
npm install
cd server && npm install && cd ..
cd web    && npm install && cd ..
```

### 3. Build the dashboard (once)

```bash
npm run build:web            # outputs to web/dist, served by the backend
```

### 4. Run

| Goal | Command |
|---|---|
| Interactive launcher (recommended) | `node launcher.js` or `npm start` |
| Server attached to terminal, log to stdout | `node launcher.js --headless` |
| Server detached, terminal exits, server keeps running | `node launcher.js --tray` |
| Start + open browser to the dashboard | `node launcher.js --open` |
| Run server only (no launcher) | `node server/index.js` |
| Dashboard hot‑reload during development | in another shell: `npm run dev:web` |

Default URL: <http://localhost:20128>
Default API base: <http://localhost:20128/v1>

### 5. The launcher menu

```
  1  🌐  Open Web UI            (browser)
  2  📊  Quota Widget           (compact view)
  3  📜  Show Server Logs       (restart attached, log to this terminal)
  4  🔽  Hide to Background     (detach server, exit launcher)
  5  ❌  Stop & Exit            (kills server too)
```

**Important behaviour:**

- Choosing **5** or pressing `Ctrl+C` in launcher mode also stops the server. Closing the terminal window does the same — the server is *attached* to your terminal by default.
- Choosing **4** *detaches* the server. After that you can close the terminal and the server keeps running. Stop it later with the printed `taskkill /PID <pid> /F` (Windows) or `kill <pid>` (\*nix) command, or via the dashboard's "Shutdown" page.
- `--tray` from the command line behaves like option **4**.

---

## 🖥️ Dashboard

Once the server is up, open <http://localhost:20128> in your browser. The dashboard is what you'll spend most of your time in.

| Page | What it does |
|---|---|
| **Providers** | Add an account / API key for each provider. OAuth providers (OpenAI Codex, Anthropic, Cursor, Kiro, Copilot, GitLab, etc.) walk you through PKCE in the browser. |
| **Models** | Per‑provider model catalogue — enable, disable, alias, set passthrough or custom routing. |
| **Routing & Combos** | Build "combos" (a model name → ordered list of providers) and pick a fallback strategy. |
| **Usage** | Real‑time charts: requests per provider, tokens, errors, P95 latency, cost estimates. |
| **Logs** | Tail recent requests with full headers/body diff between client → router → provider. |
| **CLI Tools** | One‑click integration: detects local installs of Claude Code, Codex, Cursor, Cline, Copilot, Gemini CLI, Kiro, Hermes, OpenCode, Cowork, Antigravity, Droid, OpenClaw and rewrites their config files. |
| **Translator** | Live editor for the OpenAI ↔ Anthropic ↔ Gemini ↔ Codex translation layer. Includes Monaco editor and side‑by‑side request/response views. |
| **MCP** | Manage MCP plugins, expose local stdio MCP servers over SSE, browse the bridge registry. |
| **Tunnel** | Optional Tailscale / Cloudflare‑tunnel integration for sharing your local router with another machine. |
| **Settings** | Auth mode (password / OIDC / both), proxy, TLS fingerprint, Codex Desktop client identity, log retention. |
| **Profile / Auth** | Local password, OIDC SSO (Authentik / Keycloak / Google / Okta) when enabled. |

The first time you open the dashboard you'll be asked to set a local password (or skip if you opted into OIDC‑only mode).

---

## 🔌 CLI / Coding tool integration

The dashboard's **CLI Tools** page can detect and configure all of the following automatically. The manual snippets below are for the impatient.

> All examples assume the default port `20128`. Replace `sk-...` with whatever local API key you set in **Settings → Local API key** (or leave blank if you've disabled it).

### Claude Code

```bash
# environment
export ANTHROPIC_BASE_URL="http://localhost:20128"
export ANTHROPIC_API_KEY="sk-..."

claude
```

### OpenAI Codex CLI

The dashboard auto‑edits `~/.codex/config.toml`. Manually:

```toml
[api]
base_url = "http://localhost:20128/v1"
api_key  = "sk-..."
```

### Gemini CLI

```bash
export GEMINI_API_BASE="http://localhost:20128/v1beta"
export GEMINI_API_KEY="sk-..."

gemini
```

### Cursor / Cline / Continue / Copilot

Use the **CLI Tools** page — each tool has its own auth flow and config location, and the dashboard handles them. Manual override is documented in‑app.

### Anything OpenAI‑compatible

Point the tool at:

- **Base URL**: `http://localhost:20128/v1`
- **API key**: any non‑empty string (or your configured local key)
- **Model**: any model name in **Models** or any combo from **Routing & Combos**

---

## ⚙️ Configuration

Configuration lives in two places:

| Where | What it controls |
|---|---|
| `config/config/default.yaml` | Runtime defaults: port, Codex Desktop client identity, OAuth endpoints, RTK token‑compression mode, log capacity, fingerprint settings. Edit and restart. |
| Local SQLite databases (in your data directory) | Accounts, API keys, model catalogues, combos, routing rules, usage stats, settings. **Edit through the dashboard, not by hand.** |

**Default data directory:**

| OS | Path |
|---|---|
| Windows | `%USERPROFILE%\.donixrouter\` |
| macOS | `~/.donixrouter/` |
| Linux | `~/.donixrouter/` (with graceful fallback if read‑only) |

Override with the env var `DATA_DIR=/path/to/dir`.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `20128` | HTTP port. |
| `DATA_DIR` | `~/.donixrouter` | Where the SQLite DBs and logs live. |
| `TRAY_MODE` | unset | Set internally by the launcher when running detached. |
| `NODE_ENV` | unset | Set to `production` to silence dev warnings. |

### `config/config/default.yaml` highlights

```yaml
api:
  base_url: https://chatgpt.com/backend-api
  timeout_seconds: 600

server:
  host: "::"
  port: 8080            # overridden by PORT env when launched via launcher.js

logs:
  enabled: false
  capacity: 2000
  capture_body: false
  llm_only: true

rtk:
  enabled: true
  mode: aggressive      # off | balanced | aggressive
```

> The `port:` value in YAML is the *legacy default* used when no `PORT` env var is set. The launcher always passes `PORT=20128` (or whatever you exported), so the env wins.

---

## 🧱 Project layout

```
DonixRouter/
├─ launcher.js            # Interactive CLI menu / process supervisor
├─ package.json           # Root — only launcher deps
├─ server/                # Hono backend (Node 22, ESM)
│   ├─ index.js           #   HTTP entry, auto‑mounts /server/api-routes/**
│   ├─ adapter/           #   Provider adapters
│   ├─ api-routes/        #   File‑system routing (Next‑style)
│   ├─ open-sse/          #   Streaming + chat/embeddings/image cores
│   ├─ codex-app-server/  #   Codex Desktop compatibility layer
│   ├─ mitm/              #   MITM helper (cert + manager)
│   ├─ tls/               #   Native TLS / fingerprint transport
│   ├─ lib/               #   db, oauth, mcp, tunnel, network, usage
│   └─ shared/            #   constants, components, utils shared with web
├─ web/                   # Vite + React dashboard
│   ├─ src/               #   Pages, components, stores, i18n, compat shims
│   └─ vite.config.js     #   Aliases (@, @shared, next/* compat shims)
├─ shared/                # Hooks, i18n, theme, types shared between server & web
├─ public/                # Provider icons + i18n literal JSONs (served by the server)
├─ config/                # YAML defaults, prompts, fingerprints, model maps
├─ scripts/               # One‑off scripts (e.g. README translator)
├─ images/                # Logo + screenshots
├─ build.bat / start.bat / start.sh   # Convenience wrappers (Windows / Linux)
└─ logs/                  # Runtime logs (gitignored)
```

The backend uses ESM subpath imports declared in `server/package.json`:

```json
"#lib/*": "./lib/*",
"#open-sse/*": "./open-sse/*",
"#tls":  "./tls/index.js",
"#shared/*": "./shared/*"
```

---

## 🛠️ Development

### Hot‑reload during development

Two terminals:

```bash
# terminal A — backend (nodemon‑style by re‑running)
node server/index.js

# terminal B — dashboard with HMR
npm run dev:web
```

The Vite dev server runs on `:5173` and proxies `/api` and `/v1` to the backend on `:20128`. Open `http://localhost:5173` for the live dashboard.

### Build for production

```bash
npm run build               # equivalent to: npm run build:web
node launcher.js            # serves the built dashboard from web/dist
```

### Lint

```bash
npm run lint
```

### Cleaning up

```bash
# remove all node_modules and built dashboard
rm -rf node_modules server/node_modules web/node_modules web/dist
```

---

## 🔧 Troubleshooting

### Port 20128 already in use

```bash
# pick another port
PORT=20200 node launcher.js
```

### Closed the terminal, but the dashboard is still up

You either ran with `--tray` or chose menu option **4 (Hide to Background)** — that's intentional. To stop it:

- Read the PID printed at detach time, or
- Open `.donixrouter.pid` at the project root, or
- Use the dashboard's **Settings → Shutdown** button, or
- Windows: `taskkill /PID <pid> /T /F`
- macOS / Linux: `kill <pid>`

### Server is running, but the dashboard is blank

You probably skipped the `npm run build:web` step. Either build it once, or run the Vite dev server in parallel (`npm run dev:web`) and visit `:5173` instead of `:20128`.

### "Cannot find module 'X'" after pulling updates

The merged `package.json` files may have new dependencies. Re‑run:

```bash
npm run install:all
```

### MITM / Cursor / Claude Code returns garbled output

The MITM helpers are optional and only used by tools that intercept TLS. Most users do *not* need them. If you do — the **CLI Tools** page has a per‑tool diagnostics button. Logs go to your data directory under `mitm/`.

### Codex requests fail with `400 invalid_request`

Open **Translator → Codex** and check the live request log. The translator turns Codex Responses into the upstream provider's expected schema; mismatched tools/instructions blocks are the most common cause.

### OAuth login closes the tab without success

Common causes: another instance of the router is bound to `:20128`, your browser blocked the loopback redirect, or the system clock is wrong (PKCE is time‑sensitive). Close all instances, re‑sync time, retry.

---

## 🔐 Security notes

- **Bind to loopback by default.** The server listens on `::` (all interfaces) so LAN clients can reach it. If you don't need that, set `server.host: "127.0.0.1"` in `default.yaml`.
- **Local API key.** Set one in **Settings → Local API key** so a stray script on your machine can't call upstream providers on your behalf.
- **OIDC SSO.** Available out of the box via Authentik, Keycloak, Google, Okta. Combine with the local password or use OIDC‑only mode.
- **Tokens never leave your machine.** The router stores OAuth refresh tokens locally (SQLite). They are sent only to the corresponding upstream provider during refresh.
- **Logs.** Disabled by default. If you enable body capture, treat the data directory as sensitive.

---

## 🤝 Contributing

PRs welcome — but please consider these guidelines:

1. **Upstream first.** If a bug or feature lives in the original `9router` or `codex-proxy` codebases, please file the issue / PR there as well. DonixRouter benefits when its parents stay healthy.
2. **No vendored secrets.** The repo must build with no API keys present.
3. **Match the existing style.** Server is ESM, no TypeScript build step. Dashboard is React + Vite + Tailwind. Don't add a transpiler unless absolutely necessary.
4. **Test against at least one provider** before opening a PR that touches the routing / translation layer.
5. **Be kind to the upstream maintainers.** Don't tag them on issues that aren't theirs.

---

## 📄 License

[MIT License](./LICENSE) — Copyright (c) 2024–2026 decolua and contributors.

The MIT License applies to the code in this repository. It does **not** override the licenses of upstream code that has been vendored or referenced; those licenses continue to apply to their respective files. See the file headers and the [Credits](#-credits--project-origins) section.

---

## 💬 Contact

- Issues — open one on GitHub with logs from `logs/` (redact secrets first).
- Feature requests — please confirm the feature isn't already upstream in `9router` or `codex-proxy` first.
- Security — disclose privately via the GitHub Security tab rather than a public issue.

---

<div align="center">

### Built on the shoulders of giants
[**9Router**](https://github.com/decolua/9router) · [**codex-proxy**](https://github.com/icebear0828/codex-proxy)

*Thank you for keeping AI tooling open.*

</div>

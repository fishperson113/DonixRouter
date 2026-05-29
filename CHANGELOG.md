# Changelog

All notable changes to **DonixRouter** will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — Initial release

### Added
- Hono‑based local server (`server/`) with file‑system routing under `server/api-routes/`.
- React + Vite dashboard (`web/`) served from `web/dist`.
- Interactive launcher (`launcher.js`) with attached / detached / headless / open modes.
- OpenAI‑compatible `/v1` endpoint, OpenAI Responses, Anthropic Messages, and Gemini `generateContent` translation layers.
- Provider account management, OAuth/PKCE flows, refresh scheduler, quota warnings.
- CLI integration helpers for Claude Code, Codex CLI, Gemini CLI, Cursor, Cline, Copilot, Kiro, Hermes, OpenCode, Cowork, Antigravity, Droid, OpenClaw.
- MCP stdio→SSE bridge and MCP plugin registry.
- Local SQLite persistence (`better-sqlite3` + `sql.js` fallback).
- MITM helper toolkit (optional) for tools that require local TLS interception.
- OIDC SSO (Authentik / Keycloak / Google / Okta) alongside local password auth.
- Tunnel integration (Tailscale / Cloudflare Tunnel) for sharing the local router across machines.

### Credits
- Built on the foundations of [9Router](https://github.com/decolua/9router) and [codex-proxy](https://github.com/icebear0828/codex-proxy). See [README.md](./README.md#-credits--project-origins) for the full attribution.

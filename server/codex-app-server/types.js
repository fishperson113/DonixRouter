/**
 * Codex App Server bridge types (JSDoc for IDE support).
 * JavaScript port of codex-proxy-dev/src/codex-app-server/types.ts
 */

/**
 * @typedef {{name: string, title: string, version: string}} CodexAppClientInfo
 * @typedef {{type: "none"} | {type: "capability_token", token?: string, token_file?: string} | {type: "signed_bearer_token", shared_secret?: string, shared_secret_file?: string, issuer: string, audience: string, subject: string, ttl_seconds: number}} CodexAppServerAuth
 * @typedef {{url: string, auth: CodexAppServerAuth, clientInfo: CodexAppClientInfo, requestTimeoutMs: number}} CodexAppServerClientOptions
 * @typedef {{cursor?: string, limit?: number}} ListAppsParams
 * @typedef {{model?: string, cwd?: string}} StartThreadParams
 * @typedef {{id: string, name?: string}} StartTurnAppMention
 * @typedef {"untrusted" | "on-request" | "on-failure" | "never"} OfficialAgentApprovalPolicy
 * @typedef {{threadId: string, text: string, cwd?: string, approvalPolicy?: OfficialAgentApprovalPolicy, app?: StartTurnAppMention}} StartTurnParams
 * @typedef {{method: string, params?: unknown}} CodexAppNotification
 * @typedef {{type: "result", result: unknown} | {type: "notification", notification: CodexAppNotification}} CodexAppTurnStreamEvent
 */

export {};

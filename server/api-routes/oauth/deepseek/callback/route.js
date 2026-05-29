export const dynamic = "force-dynamic";

function renderPage(initialName) {
  const safeName = JSON.stringify(initialName || "");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DeepSeek Web Callback Helper</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b1118;
      --panel: #121a24;
      --panel-2: #172231;
      --border: rgba(255,255,255,0.1);
      --text: #e8eef6;
      --muted: #9fb0c5;
      --primary: #fb7f55;
      --primary-2: #e56a4a;
      --success: #22c55e;
      --error: #ef4444;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: radial-gradient(circle at top, rgba(251,127,85,0.12), transparent 28%), var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      width: min(760px, 100%);
      background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015));
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 24px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.35);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
      line-height: 1.15;
    }
    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.55;
    }
    .stack { display: grid; gap: 16px; margin-top: 20px; }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px;
    }
    .steps {
      margin: 10px 0 0;
      padding-left: 18px;
      color: var(--muted);
      line-height: 1.7;
    }
    .actions, .tabs, .footer {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .tabs { margin-top: 8px; }
    button, .link-button {
      border: 1px solid transparent;
      border-radius: 12px;
      padding: 10px 14px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      transition: 0.15s ease;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 42px;
    }
    .primary {
      color: #fff;
      background: linear-gradient(180deg, var(--primary), var(--primary-2));
      border-color: rgba(251,127,85,0.5);
    }
    .secondary {
      color: var(--text);
      background: rgba(255,255,255,0.06);
      border-color: var(--border);
    }
    .ghost {
      color: var(--muted);
      background: transparent;
      border-color: var(--border);
    }
    .tab-active {
      color: #fff;
      background: linear-gradient(180deg, var(--primary), var(--primary-2));
      border-color: rgba(251,127,85,0.5);
    }
    label {
      display: block;
      margin-bottom: 8px;
      font-size: 14px;
      font-weight: 600;
    }
    input, textarea {
      width: 100%;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--panel-2);
      color: var(--text);
      padding: 12px 14px;
      font: inherit;
    }
    textarea {
      min-height: 190px;
      resize: vertical;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 13px;
      line-height: 1.5;
    }
    .textarea-short {
      min-height: 110px;
    }
    .hint {
      margin-top: 8px;
      font-size: 12px;
      color: var(--muted);
    }
    .status {
      display: none;
      border-radius: 14px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.05);
      line-height: 1.5;
    }
    .status.show { display: block; }
    .status.error {
      color: #fecaca;
      border-color: rgba(239,68,68,0.35);
      background: rgba(239,68,68,0.12);
    }
    .status.success {
      color: #bbf7d0;
      border-color: rgba(34,197,94,0.35);
      background: rgba(34,197,94,0.12);
    }
    .hidden { display: none; }
    code {
      background: rgba(255,255,255,0.06);
      padding: 2px 6px;
      border-radius: 8px;
    }
    @media (max-width: 640px) {
      .card { padding: 18px; }
      h1 { font-size: 24px; }
      .actions button, .actions a, .footer button { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>DeepSeek Web Login Helper</h1>
    <p>
      DeepSeek Web does not expose a standard third-party OAuth callback for DonixRouter.
      Use this helper after signing in on <code>chat.deepseek.com</code> to finish the connection with a
      <code>userToken</code>, request headers, or a browser cookie.
    </p>

    <div class="stack">
      <div class="panel">
        <div class="actions">
          <a class="link-button primary" href="https://chat.deepseek.com/sign_in" target="_blank" rel="noopener noreferrer">
            Open DeepSeek Login
          </a>
          <button id="copy-helper-url" class="secondary" type="button">Copy This Helper URL</button>
        </div>
        <ol class="steps">
          <li>Open DeepSeek Web and sign in with email, Google, or Apple in the browser.</li>
          <li>After login, open DevTools.</li>
          <li>Preferred: copy <code>userToken</code> from Local Storage at <code>https://chat.deepseek.com</code>.</li>
          <li>Alternative: copy the full Request Headers block from the Network tab.</li>
          <li>Fallback: copy the full cookie string from the Cookies panel.</li>
          <li>Paste the credential below and submit.</li>
        </ol>
      </div>

      <div class="panel">
        <div class="tabs">
          <button id="tab-token" class="tab-active" type="button">userToken</button>
          <button id="tab-cookie" class="ghost" type="button">Cookie</button>
          <button id="tab-headers" class="ghost" type="button">Request Headers</button>
        </div>

        <div class="stack">
          <div>
            <label for="connection-name">Connection Name</label>
            <input id="connection-name" type="text" placeholder="My DeepSeek Account" />
          </div>

          <div>
            <label for="quick-input">Quick Paste</label>
            <textarea
              id="quick-input"
              class="textarea-short"
              placeholder="Paste a DeepSeek userToken, Request Headers block, or Cookie. The helper will detect it automatically."
            ></textarea>
            <div class="hint">
              This field auto-detects raw bearer tokens, Local Storage JSON, full request headers, cookie strings, and exported cookie JSON.
            </div>
          </div>

          <div id="token-panel">
            <label for="token-input">DeepSeek userToken</label>
            <textarea
              id="token-input"
              placeholder='Paste the raw token or the full Local Storage value, for example: {"value":"token..."}'
            ></textarea>
            <div class="hint">
              The helper accepts a raw token or the full JSON value stored under <code>userToken</code>.
            </div>
          </div>

          <div id="cookie-panel" class="hidden">
            <label for="cookie-input">DeepSeek Cookie</label>
            <textarea
              id="cookie-input"
              placeholder="session=...; token=...; ..."
            ></textarea>
            <div class="hint">
              Full cookie string and exported cookie JSON are both supported.
            </div>
          </div>

          <div id="headers-panel" class="hidden">
            <label for="headers-input">Request Headers</label>
            <textarea
              id="headers-input"
              placeholder="authorization&#10;Bearer ...&#10;cookie&#10;smidV2=...; ds_session_id=..."
            ></textarea>
            <div class="hint">
              Paste the full raw Request Headers block from the browser Network tab. Authorization is preferred; Cookie is used as fallback.
            </div>
          </div>

          <div id="status" class="status" role="status" aria-live="polite"></div>

          <div class="footer">
            <button id="submit" class="primary" type="button">Finish Connection</button>
            <button id="close" class="secondary" type="button">Close</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const initialName = ${safeName};
    const channelName = "deepseek_web_callback";
    const loginUrl = "/api/oauth/deepseek/login";
    const elements = {
      name: document.getElementById("connection-name"),
      quickInput: document.getElementById("quick-input"),
      tokenInput: document.getElementById("token-input"),
      cookieInput: document.getElementById("cookie-input"),
      headersInput: document.getElementById("headers-input"),
      tokenPanel: document.getElementById("token-panel"),
      cookiePanel: document.getElementById("cookie-panel"),
      headersPanel: document.getElementById("headers-panel"),
      tabToken: document.getElementById("tab-token"),
      tabCookie: document.getElementById("tab-cookie"),
      tabHeaders: document.getElementById("tab-headers"),
      submit: document.getElementById("submit"),
      close: document.getElementById("close"),
      copyHelperUrl: document.getElementById("copy-helper-url"),
      status: document.getElementById("status"),
    };

    let mode = "token";
    let loading = false;
    elements.name.value = initialName;

    function parseCookieExport(rawInput) {
      try {
        const parsed = JSON.parse(rawInput);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        return items
          .filter((item) => item && typeof item.name === "string" && item.name && typeof item.value === "string")
          .map((item) => item.name + "=" + item.value);
      } catch {
        return [];
      }
    }

    function parseHeaderBlock(rawInput) {
      if (typeof rawInput !== "string") {
        return new Map();
      }

      const lines = rawInput
        .split(/\\r?\\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      const headers = new Map();
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const colonIndex = line.indexOf(":");

        if (colonIndex > 0) {
          const key = line.slice(0, colonIndex).trim().toLowerCase();
          const value = line.slice(colonIndex + 1).trim();
          if (key && value) {
            headers.set(key, value);
          }
          continue;
        }

        if (/^[a-z0-9-]+$/i.test(line) && index + 1 < lines.length) {
          headers.set(line.toLowerCase(), lines[index + 1].trim());
          index += 1;
        }
      }

      return headers;
    }

    function sanitizeTokenCandidate(value) {
      let next = typeof value === "string" ? value.trim() : "";
      next = next.replace(/^['"]|['"]$/g, "");
      if (!next) {
        return "";
      }

      try {
        next = decodeURIComponent(next);
      } catch {}

      if (/^bearer\\s+/i.test(next)) {
        next = next.replace(/^bearer\\s+/i, "").trim();
      }

      return next;
    }

    function looksLikeAccessToken(value) {
      const next = sanitizeTokenCandidate(value);
      if (!next || next.length < 20) {
        return false;
      }
      return /^[A-Za-z0-9._~\\-+/=]+$/.test(next);
    }

    function extractTokenFromStructuredValue(value) {
      if (typeof value === "string") {
        return looksLikeAccessToken(value) ? sanitizeTokenCandidate(value) : "";
      }

      if (!value || typeof value !== "object") {
        return "";
      }

      const candidates = [
        value.value,
        value.token,
        value.accessToken,
        value.access_token,
        value.userToken,
        value.user_token,
        value.authToken,
        value.auth_token,
        value.idToken,
        value.id_token,
        value.refreshToken,
        value.refresh_token,
        value.data && value.data.value,
        value.data && value.data.token,
        value.data && value.data.accessToken,
        value.data && value.data.access_token,
      ];

      for (const candidate of candidates) {
        const token = extractTokenFromStructuredValue(candidate);
        if (token) {
          return token;
        }
      }

      return "";
    }

    function normalizeTokenInput(rawInput) {
      if (typeof rawInput !== "string") {
        return "";
      }

      const trimmed = rawInput.trim();
      if (!trimmed) {
        return "";
      }

      const headers = parseHeaderBlock(trimmed);
      if (headers.has("authorization")) {
        return normalizeTokenInput(headers.get("authorization"));
      }

      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          return extractTokenFromStructuredValue(JSON.parse(trimmed));
        } catch {
          return "";
        }
      }

      if (trimmed.includes(";")) {
        return "";
      }

      return looksLikeAccessToken(trimmed) ? sanitizeTokenCandidate(trimmed) : "";
    }

    function normalizeCookieInput(rawInput) {
      if (typeof rawInput !== "string") {
        return "";
      }

      const trimmed = rawInput.trim();
      if (!trimmed) {
        return "";
      }

      const headers = parseHeaderBlock(trimmed);
      if (headers.has("cookie")) {
        return normalizeCookieInput(headers.get("cookie"));
      }

      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        const cookiePairs = parseCookieExport(trimmed);
        if (cookiePairs.length > 0) {
          return cookiePairs.join("; ");
        }
      }

      return trimmed
        .replace(/\\r?\\n+/g, "; ")
        .replace(/;\\s*;/g, ";")
        .replace(/\\s{2,}/g, " ")
        .trim()
        .replace(/;\\s*$/, "");
    }

    function looksLikeCookiePayload(rawInput) {
      if (typeof rawInput !== "string") {
        return false;
      }

      const trimmed = rawInput.trim();
      if (!trimmed) {
        return false;
      }

      const headers = parseHeaderBlock(trimmed);
      if (headers.has("cookie")) {
        return true;
      }

      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        return parseCookieExport(trimmed).length > 0;
      }

      if (trimmed.includes("authorization")) {
        return false;
      }

      return /(^|;\\s*)[^=\\s;]+=[^;]+/.test(trimmed);
    }

    function detectDeepSeekPasteInput(rawInput) {
      if (typeof rawInput !== "string") {
        return null;
      }

      const trimmed = rawInput.trim();
      if (!trimmed) {
        return null;
      }

      const headers = parseHeaderBlock(trimmed);
      if (headers.has("authorization") || headers.has("cookie") || headers.size > 1) {
        return {
          mode: "headers",
          value: trimmed,
          label: "Request Headers",
        };
      }

      const token = normalizeTokenInput(trimmed);
      if (token) {
        return {
          mode: "token",
          value: token,
          label: "DeepSeek userToken",
        };
      }

      if (looksLikeCookiePayload(trimmed)) {
        const cookie = normalizeCookieInput(trimmed);
        if (cookie) {
          return {
            mode: "cookie",
            value: cookie,
            label: "DeepSeek Cookie",
          };
        }
      }

      return null;
    }

    function setMode(nextMode) {
      mode = nextMode;
      const isToken = nextMode === "token";
      const isCookie = nextMode === "cookie";
      const isHeaders = nextMode === "headers";
      elements.tokenPanel.classList.toggle("hidden", !isToken);
      elements.cookiePanel.classList.toggle("hidden", !isCookie);
      elements.headersPanel.classList.toggle("hidden", !isHeaders);
      elements.tabToken.className = isToken ? "tab-active" : "ghost";
      elements.tabCookie.className = isCookie ? "tab-active" : "ghost";
      elements.tabHeaders.className = isHeaders ? "tab-active" : "ghost";
      clearStatus();
    }

    function setLoading(nextLoading) {
      loading = nextLoading;
      elements.submit.disabled = nextLoading;
      elements.close.disabled = nextLoading;
      elements.copyHelperUrl.disabled = nextLoading;
      elements.tabToken.disabled = nextLoading;
      elements.tabCookie.disabled = nextLoading;
      elements.tabHeaders.disabled = nextLoading;
      elements.quickInput.disabled = nextLoading;
      elements.submit.textContent = nextLoading ? "Connecting..." : "Finish Connection";
    }

    function showStatus(kind, message) {
      elements.status.textContent = message;
      elements.status.className = "status show " + kind;
    }

    function clearStatus() {
      elements.status.textContent = "";
      elements.status.className = "status";
    }

    function applyDetectedCredential(rawInput, detected) {
      const resolved = detected || detectDeepSeekPasteInput(rawInput);
      if (!resolved) {
        return false;
      }

      elements.quickInput.value = rawInput;
      setMode(resolved.mode);

      if (resolved.mode === "token") {
        elements.tokenInput.value = resolved.value;
      } else if (resolved.mode === "cookie") {
        elements.cookieInput.value = resolved.value;
      } else {
        elements.headersInput.value = resolved.value;
      }

      showStatus("success", "Detected " + resolved.label + ". The helper switched to the matching login mode automatically.");
      return true;
    }

    function relaySuccess(payload) {
      const eventPayload = { ...payload, timestamp: Date.now() };

      if (window.opener) {
        try {
          window.opener.postMessage({ type: channelName, data: eventPayload }, window.location.origin);
        } catch {}
      }

      try {
        const channel = new BroadcastChannel(channelName);
        channel.postMessage(eventPayload);
        channel.close();
      } catch {}

      try {
        localStorage.setItem(channelName, JSON.stringify(eventPayload));
      } catch {}
    }

    async function submit() {
      if (loading) return;

      const name = elements.name.value.trim();
      const credential = mode === "token"
        ? elements.tokenInput.value.trim()
        : mode === "cookie"
          ? elements.cookieInput.value.trim()
          : elements.headersInput.value.trim();

      if (!credential) {
        showStatus("error", mode === "token"
          ? "Paste the DeepSeek userToken first."
          : mode === "cookie"
            ? "Paste the DeepSeek cookie first."
            : "Paste the DeepSeek request headers first.");
        return;
      }

      setLoading(true);
      clearStatus();

      try {
        const payload = mode === "token"
          ? { method: "browser", token: credential, name: name || undefined }
          : mode === "cookie"
            ? { method: "cookie", cookie: credential, name: name || undefined }
            : { method: "headers", headers: credential, name: name || undefined };

        const response = await fetch(loginUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "DeepSeek login failed");
        }

        relaySuccess(data);
        showStatus("success", data.message || "DeepSeek connected successfully. This window will close shortly.");
        setTimeout(() => window.close(), 1200);
      } catch (error) {
        showStatus("error", error.message || "DeepSeek login failed");
      } finally {
        setLoading(false);
      }
    }

    function handleAutoDetectPaste(event) {
      const pastedText = event.clipboardData && event.clipboardData.getData("text");
      if (!pastedText) {
        return;
      }

      const detected = detectDeepSeekPasteInput(pastedText);
      if (!detected) {
        return;
      }

      event.preventDefault();
      applyDetectedCredential(pastedText, detected);
    }

    elements.tabToken.addEventListener("click", () => setMode("token"));
    elements.tabCookie.addEventListener("click", () => setMode("cookie"));
    elements.tabHeaders.addEventListener("click", () => setMode("headers"));
    elements.submit.addEventListener("click", submit);
    elements.close.addEventListener("click", () => window.close());
    elements.copyHelperUrl.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        showStatus("success", "Helper URL copied.");
      } catch {
        showStatus("error", "Failed to copy helper URL.");
      }
    });

    elements.quickInput.addEventListener("paste", handleAutoDetectPaste);
    elements.quickInput.addEventListener("input", () => {
      const value = elements.quickInput.value;
      if (!value.trim()) {
        clearStatus();
        return;
      }

      const detected = detectDeepSeekPasteInput(value);
      if (detected) {
        applyDetectedCredential(value, detected);
      }
    });

    elements.tokenInput.addEventListener("paste", handleAutoDetectPaste);
    elements.cookieInput.addEventListener("paste", handleAutoDetectPaste);
    elements.headersInput.addEventListener("paste", handleAutoDetectPaste);

    elements.tokenInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        submit();
      }
    });
    elements.cookieInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        submit();
      }
    });
    elements.headersInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        submit();
      }
    });
  </script>
</body>
</html>`;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name") || "";

  return new Response(renderPage(name), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

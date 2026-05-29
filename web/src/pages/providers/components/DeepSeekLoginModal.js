import { useEffect, useRef, useState } from "react";
import { Modal, Input, Button } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const DEEPSEEK_CALLBACK_CHANNEL = "deepseek_web_callback";
const CREDENTIAL_TEXTAREA_CLASS_NAME = "w-full resize-y rounded-[14px] border border-white/45 bg-white/74 px-3.5 py-2.5 text-sm text-text-main shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] placeholder:text-text-muted/72 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500/45 disabled:opacity-50 disabled:cursor-not-allowed dark:border-white/8 dark:bg-[rgba(255,255,255,0.035)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] dark:focus:border-brand-500/35 dark:focus:bg-[rgba(255,255,255,0.045)]";

function parseCookieExport(rawInput) {
  try {
    const parsed = JSON.parse(rawInput);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .filter((item) => item && typeof item.name === "string" && item.name && typeof item.value === "string")
      .map((item) => `${item.name}=${item.value}`);
  } catch {
    return [];
  }
}

function parseHeaderBlock(rawInput) {
  if (typeof rawInput !== "string") {
    return new Map();
  }

  const lines = rawInput
    .split(/\r?\n/)
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
  } catch {
    // Keep the original candidate if decodeURIComponent fails.
  }

  if (/^bearer\s+/i.test(next)) {
    next = next.replace(/^bearer\s+/i, "").trim();
  }

  return next;
}

function looksLikeAccessToken(value) {
  const next = sanitizeTokenCandidate(value);
  if (!next || next.length < 20) {
    return false;
  }
  return /^[A-Za-z0-9._~\-+/=]+$/.test(next);
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
    value.data?.value,
    value.data?.token,
    value.data?.accessToken,
    value.data?.access_token,
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
    .replace(/\r?\n+/g, "; ")
    .replace(/;\s*;/g, ";")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/;\s*$/, "");
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

  return /(^|;\s*)[^=\s;]+=[^;]+/.test(trimmed);
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
      mode: "browser",
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

export default function DeepSeekLoginModal({ isOpen, onClose, onSuccess }) {
  const [mode, setMode] = useState("oauth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cookie, setCookie] = useState("");
  const [browserToken, setBrowserToken] = useState("");
  const [headersDump, setHeadersDump] = useState("");
  const [quickPaste, setQuickPaste] = useState("");
  const [quickPasteStatus, setQuickPasteStatus] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const callbackHandledRef = useRef(false);
  const notify = useNotificationStore();

  const resetForm = () => {
    setMode("oauth");
    setEmail("");
    setPassword("");
    setCookie("");
    setBrowserToken("");
    setHeadersDump("");
    setQuickPaste("");
    setQuickPasteStatus("");
    setName("");
  };

  const applyDetectedCredential = (rawValue, detected = detectDeepSeekPasteInput(rawValue)) => {
    if (!detected) {
      return false;
    }

    setQuickPaste(rawValue);
    setQuickPasteStatus(`Đã nhận diện ${detected.label}. Modal tự chuyển sang chế độ đăng nhập tương ứng.`);
    setMode(detected.mode);

    if (detected.mode === "browser") {
      setBrowserToken(detected.value);
      return true;
    }

    if (detected.mode === "cookie") {
      setCookie(detected.value);
      return true;
    }

    setHeadersDump(detected.value);
    return true;
  };

  const handleQuickPasteChange = (value) => {
    setQuickPaste(value);
    if (!value.trim()) {
      setQuickPasteStatus("");
      return;
    }

    const detected = detectDeepSeekPasteInput(value);
    if (detected) {
      applyDetectedCredential(value, detected);
      return;
    }

    setQuickPasteStatus("Chưa nhận diện được token, cookie hay khối request headers nào của DeepSeek.");
  };

  const handleCredentialPaste = (event) => {
    const pastedText = event.clipboardData?.getData("text") || "";
    if (!pastedText) {
      return;
    }

    const detected = detectDeepSeekPasteInput(pastedText);
    if (!detected) {
      return;
    }

    event.preventDefault();
    applyDetectedCredential(pastedText, detected);
  };

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") {
      return undefined;
    }

    callbackHandledRef.current = false;

    const handleCallbackData = (payload) => {
      if (!payload || callbackHandledRef.current) {
        return;
      }

      callbackHandledRef.current = true;
      notify.success(payload.message || "Đăng nhập DeepSeek qua trình duyệt thành công!");
      onSuccess?.(payload);
      resetForm();
      onClose();
    };

    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (event.data?.type === DEEPSEEK_CALLBACK_CHANNEL) {
        handleCallbackData(event.data.data);
      }
    };

    const handleStorage = (event) => {
      if (event.key !== DEEPSEEK_CALLBACK_CHANNEL || !event.newValue) {
        return;
      }
      try {
        const data = JSON.parse(event.newValue);
        if (!data?.timestamp || Date.now() - data.timestamp < 60_000) {
          handleCallbackData(data);
        }
        localStorage.removeItem(DEEPSEEK_CALLBACK_CHANNEL);
      } catch {
        // Ignore malformed local storage payloads.
      }
    };

    window.addEventListener("message", handleMessage);
    window.addEventListener("storage", handleStorage);

    let channel = null;
    try {
      channel = new BroadcastChannel(DEEPSEEK_CALLBACK_CHANNEL);
      channel.onmessage = (event) => handleCallbackData(event.data);
    } catch {
      channel = null;
    }

    try {
      const stored = localStorage.getItem(DEEPSEEK_CALLBACK_CHANNEL);
      if (stored) {
        const data = JSON.parse(stored);
        if (!data?.timestamp || Date.now() - data.timestamp < 60_000) {
          handleCallbackData(data);
        }
        localStorage.removeItem(DEEPSEEK_CALLBACK_CHANNEL);
      }
    } catch {
      // Ignore malformed local storage payloads.
    }

    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
      if (channel) {
        channel.close();
      }
    };
  }, [isOpen, notify, onClose, onSuccess]);

  const handleLogin = async () => {
    if (mode === "oauth" && (!email.trim() || !password.trim())) {
      notify.error("Vui lòng nhập email/số điện thoại và mật khẩu");
      return;
    }

    if (mode === "cookie" && !cookie.trim()) {
      notify.error("Vui lòng dán cookie DeepSeek");
      return;
    }

    if (mode === "browser" && !browserToken.trim()) {
      notify.error("Vui lòng dán userToken của DeepSeek");
      return;
    }

    if (mode === "headers" && !headersDump.trim()) {
      notify.error("Vui lòng dán khối request headers của DeepSeek");
      return;
    }

    setLoading(true);
    try {
      const payload = mode === "cookie"
        ? {
            method: "cookie",
            cookie: cookie.trim(),
            name: name.trim() || undefined,
          }
        : mode === "browser"
          ? {
              method: "browser",
              token: browserToken.trim(),
              name: name.trim() || undefined,
            }
          : mode === "headers"
            ? {
                method: "headers",
                headers: headersDump.trim(),
                name: name.trim() || undefined,
              }
            : {
                method: "oauth",
                email: email.trim(),
                password: password.trim(),
                name: name.trim() || undefined,
              };

      const response = await fetch("/api/oauth/deepseek/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Đăng nhập thất bại");
      }

      notify.success(
        mode === "cookie"
          ? "Đã kết nối DeepSeek bằng cookie!"
          : mode === "browser"
            ? "Đã kết nối DeepSeek bằng userToken!"
            : mode === "headers"
              ? "Đã kết nối DeepSeek bằng request headers!"
              : "Đã kết nối tài khoản DeepSeek!",
      );
      onSuccess?.(data);
      resetForm();
      onClose();
    } catch (error) {
      notify.error(error.message || "Kết nối DeepSeek thất bại");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      resetForm();
      onClose();
    }
  };

  const openDeepSeekWebLogin = () => {
    window.open("https://chat.deepseek.com/sign_in", "_blank", "noopener,noreferrer");
  };

  const openDeepSeekCallbackHelper = () => {
    const url = new URL("/api/oauth/deepseek/callback", window.location.origin);
    if (name.trim()) {
      url.searchParams.set("name", name.trim());
    }
    window.open(url.toString(), "deepseek_web_callback", "width=860,height=820");
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Kết nối tài khoản DeepSeek"
      size="md"
    >
      <div className="space-y-4">
        <div className="flex gap-2 rounded-xl border border-border-primary bg-bg-secondary p-1">
          <Button
            variant={mode === "oauth" ? "primary" : "ghost"}
            size="sm"
            className="flex-1"
            onClick={() => setMode("oauth")}
            disabled={loading}
          >
            Email + Mật khẩu
          </Button>
          <Button
            variant={mode === "cookie" ? "primary" : "ghost"}
            size="sm"
            className="flex-1"
            onClick={() => setMode("cookie")}
            disabled={loading}
          >
            Cookie
          </Button>
          <Button
            variant={mode === "browser" ? "primary" : "ghost"}
            size="sm"
            className="flex-1"
            onClick={() => setMode("browser")}
            disabled={loading}
          >
            Web Login
          </Button>
          <Button
            variant={mode === "headers" ? "primary" : "ghost"}
            size="sm"
            className="flex-1"
            onClick={() => setMode("headers")}
            disabled={loading}
          >
            Raw Headers
          </Button>
        </div>

        <div className="bg-bg-secondary p-3 rounded-lg border border-border-primary">
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-primary text-xl mt-0.5">info</span>
            <div className="text-sm">
              <p className="text-text-primary font-medium mb-1">
                {mode === "cookie"
                  ? "Đăng nhập bằng Cookie"
                  : mode === "browser"
                    ? "Đăng nhập qua Web"
                    : mode === "headers"
                      ? "Đăng nhập bằng Raw Headers"
                      : "Đăng nhập bằng Mật khẩu"}
              </p>
              {mode === "cookie" ? (
                <p className="text-text-muted">
                  Dán chuỗi cookie đầy đủ từ chat.deepseek.com. Hỗ trợ cả chuỗi cookie thô và JSON cookie xuất từ DevTools.
                </p>
              ) : mode === "browser" ? (
                <p className="text-text-muted">
                  Dán userToken DeepSeek trực tiếp vào đây, hoặc mở trang đăng nhập DeepSeek Web rồi hoàn tất qua cửa sổ callback của DonixRouter.
                </p>
              ) : mode === "headers" ? (
                <p className="text-text-muted">
                  Dán toàn bộ khối Request Headers sao chép từ tab Network của DevTools. DonixRouter sẽ ưu tiên trích xuất Authorization, sau đó fallback sang Cookie tự động.
                </p>
              ) : (
                <p className="text-text-muted">
                  Đăng nhập bằng tài khoản DeepSeek để dùng các model từ chat.deepseek.com.
                  DonixRouter lưu mật khẩu cục bộ để tự động đăng nhập lại khi token hết hạn.
                </p>
              )}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">
            Tên kết nối (Tùy chọn)
          </label>
          <Input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Tài khoản DeepSeek của tôi"
            disabled={loading}
          />
        </div>

        <div className="bg-bg-tertiary p-3 rounded-lg space-y-2">
          <label className="block text-sm font-medium text-text-primary">
            Dán nhanh (Tùy chọn)
          </label>
          <textarea
            value={quickPaste}
            onChange={(event) => handleQuickPasteChange(event.target.value)}
            onPaste={(event) => {
              const pastedText = event.clipboardData?.getData("text") || "";
              if (!pastedText) {
                return;
              }
              event.preventDefault();
              handleQuickPasteChange(pastedText);
            }}
            placeholder="Dán userToken, khối Request Headers, hoặc Cookie vào đây. DonixRouter sẽ tự chuyển sang chế độ phù hợp."
            disabled={loading}
            rows={4}
            className={CREDENTIAL_TEXTAREA_CLASS_NAME}
          />
          <p className="text-xs text-text-muted">
            Ô này tự nhận diện bearer token thô, JSON từ Local Storage, khối request headers đầy đủ, chuỗi cookie, và JSON cookie xuất từ DevTools.
          </p>
          {quickPasteStatus ? (
            <p className="text-xs text-primary">{quickPasteStatus}</p>
          ) : null}
        </div>

        {mode === "oauth" ? (
          <>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Email hoặc Số điện thoại <span className="text-error">*</span>
              </label>
              <Input
                type="text"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="email@example.com hoặc số điện thoại"
                disabled={loading}
                autoComplete="username"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Mật khẩu <span className="text-error">*</span>
              </label>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Mật khẩu DeepSeek của bạn"
                disabled={loading}
                autoComplete="current-password"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !loading) {
                    handleLogin();
                  }
                }}
              />
            </div>

            <div className="bg-bg-tertiary p-3 rounded-lg">
              <p className="text-xs text-text-muted">
                <strong>Bảo mật:</strong> Mật khẩu chỉ được lưu cục bộ trong kết nối DonixRouter để tự động làm mới phiên DeepSeek khi cần.
              </p>
            </div>
          </>
        ) : mode === "cookie" ? (
          <>
            <div className="bg-bg-tertiary p-3 rounded-lg">
              <p className="text-xs text-text-muted mb-2">
                Lấy cookie từ{" "}
                <a
                  href="https://chat.deepseek.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  chat.deepseek.com
                </a>
                {" "}sau khi đăng nhập.
              </p>
              <ol className="list-decimal list-inside space-y-1 text-xs text-text-muted">
                <li>Mở DeepSeek Web và đăng nhập.</li>
                <li>Mở DevTools bằng F12.</li>
                <li>Sao chép chuỗi cookie đầy đủ, hoặc xuất JSON cookie từ panel Cookies.</li>
                <li>Dán vào ô bên dưới.</li>
              </ol>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Cookie <span className="text-error">*</span>
              </label>
              <textarea
                value={cookie}
                onChange={(event) => setCookie(event.target.value)}
                onPaste={handleCredentialPaste}
                placeholder="session=...; token=...; ..."
                disabled={loading}
                rows={6}
                className={CREDENTIAL_TEXTAREA_CLASS_NAME}
              />
              <p className="mt-1 text-xs text-text-muted">
                Hỗ trợ cả chuỗi cookie thô và JSON cookie xuất từ DevTools.
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Cookie phải chứa dữ liệu token xác thực DeepSeek. Chỉ có <code>aws-waf-token</code> hoặc <code>ds_session_id</code> là chưa đủ.
              </p>
            </div>

            <div className="bg-bg-tertiary p-3 rounded-lg">
              <p className="text-xs text-text-muted">
                <strong>Bảo mật:</strong> Cookie chỉ được lưu cục bộ trong kết nối DonixRouter và sẽ được dùng lại để làm mới phiên DeepSeek khi có thể.
              </p>
            </div>
          </>
        ) : mode === "headers" ? (
          <>
            <div className="bg-bg-tertiary p-3 rounded-lg space-y-2">
              <p className="text-xs text-text-muted">
                Sao chép toàn bộ request headers từ bất kỳ request đã xác thực nào tới <code>chat.deepseek.com</code>.
              </p>
              <ol className="list-decimal list-inside space-y-1 text-xs text-text-muted">
                <li>Mở DeepSeek Web và đăng nhập.</li>
                <li>Mở DevTools, chuyển sang tab Network.</li>
                <li>Mở bất kỳ request nào gửi tới <code>chat.deepseek.com</code>.</li>
                <li>Sao chép toàn bộ khối Request Headers.</li>
                <li>Dán vào ô bên dưới mà không chỉnh sửa.</li>
              </ol>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Request Headers <span className="text-error">*</span>
              </label>
              <textarea
                value={headersDump}
                onChange={(event) => setHeadersDump(event.target.value)}
                onPaste={handleCredentialPaste}
                placeholder={"authorization\nBearer ...\ncookie\nsmidV2=...; ds_session_id=..."}
                disabled={loading}
                rows={9}
                className={CREDENTIAL_TEXTAREA_CLASS_NAME}
              />
              <p className="mt-1 text-xs text-text-muted">
                Hỗ trợ dump headers thô, kể cả khối chứa cả <code>authorization</code> lẫn <code>cookie</code>.
              </p>
            </div>

            <div className="bg-bg-tertiary p-3 rounded-lg">
              <p className="text-xs text-text-muted">
                <strong>Bảo mật:</strong> DonixRouter sẽ trích xuất token xác thực DeepSeek từ headers đã dán và chỉ lưu cục bộ trong kết nối của bạn.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="bg-bg-tertiary p-3 rounded-lg space-y-2">
              <p className="text-xs text-text-muted">
                Luồng này mở trang đăng nhập DeepSeek Web thật, sau đó hoàn tất qua trang callback của DonixRouter.
              </p>
              <ol className="list-decimal list-inside space-y-1 text-xs text-text-muted">
                <li>Mở trang đăng nhập DeepSeek Web.</li>
                <li>Đăng nhập bằng email, Google, hoặc Apple.</li>
                <li>Mở cửa sổ callback helper.</li>
                <li>Dán userToken, request headers đầy đủ, hoặc chuỗi cookie.</li>
              </ol>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                variant="primary"
                onClick={openDeepSeekWebLogin}
                disabled={loading}
              >
                Mở DeepSeek Web
              </Button>
              <Button
                variant="secondary"
                onClick={openDeepSeekCallbackHelper}
                disabled={loading}
              >
                Mở Callback Helper
              </Button>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                DeepSeek userToken <span className="text-error">*</span>
              </label>
              <textarea
                value={browserToken}
                onChange={(event) => setBrowserToken(event.target.value)}
                onPaste={handleCredentialPaste}
                placeholder='Dán token thô hoặc giá trị Local Storage đầy đủ, ví dụ: {"value":"token..."}'
                disabled={loading}
                rows={6}
                className={CREDENTIAL_TEXTAREA_CLASS_NAME}
              />
              <p className="mt-1 text-xs text-text-muted">
                Hỗ trợ bearer token thô và JSON từ Local Storage. Nếu bạn dán request headers hoặc cookie vào đây, DonixRouter sẽ tự chuyển sang chế độ phù hợp.
              </p>
            </div>

            <div className="bg-bg-tertiary p-3 rounded-lg">
              <p className="text-xs text-text-muted">
                <strong>Bảo mật:</strong> Chế độ Web Login chỉ lưu token DeepSeek web cục bộ. Mật khẩu DeepSeek của bạn không bao giờ được lưu trong luồng này.
              </p>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="secondary"
            onClick={handleClose}
            disabled={loading}
          >
            Hủy
          </Button>
          <Button
            variant="primary"
            onClick={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="material-symbols-outlined animate-spin text-base mr-1">progress_activity</span>
                Đang kết nối...
              </>
            ) : (
              mode === "cookie"
                ? "Kết nối bằng Cookie"
                : mode === "browser"
                  ? "Kết nối bằng userToken"
                  : mode === "headers"
                    ? "Kết nối bằng Headers"
                    : "Kết nối"
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

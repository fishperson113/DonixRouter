/**
 * Minimal shim for next/server's NextResponse and NextRequest.
 * Allows existing route handlers to work without the Next.js dependency.
 *
 * Only implements the subset actually used by donixrouter API routes.
 */

export class NextResponse extends Response {
  /**
   * Create a JSON response (mirrors NextResponse.json())
   */
  static json(data, init = {}) {
    const body = JSON.stringify(data);
    const headers = new Headers(init.headers || {});
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return new Response(body, {
      status: init.status || 200,
      statusText: init.statusText,
      headers,
    });
  }

  /**
   * Create a redirect response
   */
  static redirect(url, status = 307) {
    return new Response(null, {
      status,
      headers: { Location: typeof url === "string" ? url : url.toString() },
    });
  }

  /**
   * Create a "next" response (passthrough — not used in API routes, stub only)
   */
  static next(init) {
    return new Response(null, { status: 200, ...init });
  }
}

/**
 * Shim for next/headers cookies() — returns a cookie store backed by a Map.
 * Since we don't have access to the request in this static function,
 * the route adapter injects cookies via a global context.
 */
const _cookieStore = new Map();
let _requestHeaders = new Headers();

export function setRequestContext(request) {
  _requestHeaders = request.headers;
  _cookieStore.clear();
  const cookieHeader = request.headers.get("cookie") || "";
  for (const pair of cookieHeader.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name) _cookieStore.set(name, rest.join("="));
  }
}

export function cookies() {
  return {
    get(name) { const v = _cookieStore.get(name); return v !== undefined ? { name, value: v } : undefined; },
    getAll() { return [..._cookieStore.entries()].map(([name, value]) => ({ name, value })); },
    set(name, value, options) { _cookieStore.set(name, value); },
    delete(name) { _cookieStore.delete(name); },
    has(name) { return _cookieStore.has(name); },
  };
}

export function headers() {
  return _requestHeaders;
}

export class NextRequest extends Request {
  constructor(input, init) {
    super(input, init);
    this._url = new URL(typeof input === "string" ? input : input.url);
  }

  get nextUrl() {
    return this._url;
  }
}

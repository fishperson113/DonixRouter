/**
 * use-console-logs — SSE tail of the proxy's process stdout/stderr.
 *
 * Subscribes to `/admin/logs/console-stream`. Server pushes:
 *   - { type: "init", lines: string[] }  on open
 *   - { type: "line", line: string }     on every new console.* invocation
 *   - { type: "clear" }                  after DELETE /admin/logs/console
 */

import { useCallback, useEffect, useRef, useState } from "preact/hooks";

const MAX_LINES_CLIENT = 2000;

export function useConsoleLogs() {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let es: EventSource;
    try {
      es = new EventSource("/admin/logs/console-stream");
    } catch {
      return;
    }
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as
          | { type: "init"; lines: string[] }
          | { type: "line"; line: string }
          | { type: "clear" };
        if (msg.type === "init") {
          setLines(msg.lines.slice(-MAX_LINES_CLIENT));
        } else if (msg.type === "line") {
          setLines((prev) => {
            const next = prev.concat(msg.line);
            return next.length > MAX_LINES_CLIENT
              ? next.slice(-MAX_LINES_CLIENT)
              : next;
          });
        } else if (msg.type === "clear") {
          setLines([]);
        }
      } catch {
        // ignore malformed
      }
    };
    es.onerror = () => setConnected(false);

    return () => {
      try { es.close(); } catch {}
      esRef.current = null;
    };
  }, []);

  const clear = useCallback(async () => {
    try {
      await fetch("/admin/logs/console", { method: "DELETE" });
    } catch {
      // server-side clear will arrive via SSE; ignore network failure here
    }
  }, []);

  return { lines, connected, clear };
}

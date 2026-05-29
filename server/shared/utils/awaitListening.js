/**
 * Await `server.listening` becoming true (or `error` firing first).
 *
 * Why this exists: `serve()` from `@hono/node-server` is synchronous —
 * it returns the underlying `http.Server` immediately, while `listen()`
 * runs asynchronously. That window is the difference between
 * "startServer resolved" and "the socket is actually bound", and it's
 * where bind-time failures (EADDRINUSE, EACCES, ENETDOWN) escape any
 * try/catch wrapped around `await startServer(...)` and bubble up as
 * an uncaughtException.
 *
 * This helper bridges the gap by listening for both terminal events
 * and removing both listeners once one wins, so the helper itself
 * never leaks subscriptions on the long-lived server object.
 *
 * JavaScript port of codex-proxy-dev/src/utils/await-listening.ts
 */

export function awaitServerListening(server) {
  if (server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.removeListener("listening", onListening);
      server.removeListener("error", onError);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    server.once("listening", onListening);
    server.once("error", onError);
  });
}

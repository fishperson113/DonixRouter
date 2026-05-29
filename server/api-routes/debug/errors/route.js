/**
 * /api/debug/errors — Error log viewer + cursor management
 *
 * GET  — read grouped error log + unread count
 * POST — mark as read (set cursor)
 */

import { readErrorLog, groupErrorLog, getUnreadCount, setReadCursor } from "../../../logs/error-log.js";

export async function GET(request) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get("limit") || "200", 10);
  const entries = readErrorLog(limit);
  const groups = groupErrorLog(entries);
  const unread = getUnreadCount(entries);

  return Response.json({ groups, unread, total: entries.length });
}

export async function POST(request) {
  const body = await request.json();
  if (body.action === "markRead" && body.ts) {
    setReadCursor(body.ts);
    return Response.json({ ok: true });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}

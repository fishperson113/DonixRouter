/**
 * /api/debug/proxies — Proxy pool CRUD + health check
 *
 * GET  — list all proxies + assignments
 * POST — add/remove/update/assign/healthcheck
 */

import { getProxyPool } from "#tls/proxy-pool-singleton.js";

export async function GET() {
  const pool = getProxyPool();
  return Response.json({
    proxies: pool.getAllMasked(),
    assignments: pool.getAllAssignments(),
    healthIntervalMinutes: pool.getHealthIntervalMinutes(),
  });
}

export async function POST(request) {
  const body = await request.json();
  const pool = getProxyPool();
  const { action } = body;

  switch (action) {
    case "add": {
      const id = pool.add(body.name || "Proxy", body.url);
      return Response.json({ ok: true, id });
    }
    case "remove": {
      const ok = pool.remove(body.id);
      return Response.json({ ok });
    }
    case "update": {
      const ok = pool.update(body.id, { name: body.name, url: body.url });
      return Response.json({ ok });
    }
    case "enable": {
      const ok = pool.enable(body.id);
      return Response.json({ ok });
    }
    case "disable": {
      const ok = pool.disable(body.id);
      return Response.json({ ok });
    }
    case "assign": {
      pool.assign(body.accountId, body.proxyId);
      return Response.json({ ok: true });
    }
    case "unassign": {
      pool.unassign(body.accountId);
      return Response.json({ ok: true });
    }
    case "healthCheck": {
      const info = await pool.healthCheck(body.id);
      return Response.json({ ok: true, health: info });
    }
    case "healthCheckAll": {
      await pool.healthCheckAll();
      return Response.json({ ok: true, proxies: pool.getAllMasked() });
    }
    case "setInterval": {
      pool.setHealthIntervalMinutes(body.minutes || 5);
      return Response.json({ ok: true });
    }
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}

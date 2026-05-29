/**
 * GET /api/debug/tls — TLS transport + proxy diagnostic info
 */

import { getTransportInfo } from "#tls";
import { getProxyUrl } from "#tls/proxy.js";

export async function GET() {
  const info = getTransportInfo();
  return Response.json({
    transport: info,
    proxy: {
      url: getProxyUrl(),
    },
  });
}

/**
 * Auto-discover and mount all Next.js-style API routes from api-routes/ directory.
 * Converts filesystem paths to Hono route paths and imports route modules dynamically.
 */

import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { mountRoute, fsPathToHonoPath, HTTP_METHODS } from "./nextRouteAdapter.js";
const HTTP_METHODS_SET = new Set(HTTP_METHODS);

/**
 * Recursively find all route.js files under a directory.
 * @param {string} dir
 * @returns {Promise<string[]>} Array of absolute paths to route.js files
 */
async function findRouteFiles(dir) {
  const results = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await findRouteFiles(fullPath));
    } else if (entry.name === "route.js") {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Auto-mount all API routes onto a Hono app.
 * @param {import("hono").Hono} app - The Hono app to mount routes on
 * @param {string} apiRoutesDir - Absolute path to api-routes/ directory
 */
export async function autoMountRoutes(app, apiRoutesDir) {
  const routeFiles = await findRouteFiles(apiRoutesDir);
  let mounted = 0;
  let failed = 0;

  for (const filePath of routeFiles) {
    // Get the relative path from api-routes dir, remove trailing /route.js
    const relPath = relative(apiRoutesDir, filePath)
      .replace(/[/\\]route\.js$/, "")
      .split(sep)
      .join("/");

    const honoPath = fsPathToHonoPath(relPath);

    try {
      const moduleUrl = pathToFileURL(filePath).href;
      const routeModule = await import(moduleUrl);
      const methods = Object.keys(routeModule).filter(k => typeof routeModule[k] === 'function' && HTTP_METHODS_SET.has(k));
      mountRoute(app, honoPath, routeModule);
      mounted++;
      if (honoPath.includes('auth/status') || honoPath.includes('quota-stream')) {
        console.log(`[Routes] ✓ ${honoPath} [${methods.join(',')}]`);
      }
    } catch (err) {
      // Log but don't fail — some routes may have missing dependencies during migration
      console.warn(`[Routes] ⚠ Skip ${honoPath}: ${err.message?.split("\n")[0] || err}`);
      failed++;
    }
  }

  console.log(`[Routes] Mounted ${mounted} routes (${failed} skipped)`);
}

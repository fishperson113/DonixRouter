/**
 * ESM wrapper for CJS mitm/manager.js
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const manager = require("./manager.cjs");

export const getMitmStatus = manager.getMitmStatus;
export const startServer = manager.startServer;
export const stopServer = manager.stopServer;
export const enableToolDNS = manager.enableToolDNS;
export const disableToolDNS = manager.disableToolDNS;
export const trustCert = manager.trustCert;
export const startMitm = manager.startMitm;
export const stopMitm = manager.stopMitm;
export const getCachedPassword = manager.getCachedPassword;
export const setCachedPassword = manager.setCachedPassword;
export const loadEncryptedPassword = manager.loadEncryptedPassword;
export const clearEncryptedPassword = manager.clearEncryptedPassword;
export const isSudoPasswordRequired = manager.isSudoPasswordRequired;
export const initDbHooks = manager.initDbHooks;
export const restoreToolDNS = manager.restoreToolDNS;
export const hasDnsPrivilege = manager.hasDnsPrivilege;
export const removeAllDNSEntriesSync = manager.removeAllDNSEntriesSync;

export default manager;

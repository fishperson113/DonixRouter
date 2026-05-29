/**
 * ESM wrapper for CJS mitm/dns/dnsConfig.js
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const dnsConfig = require("./dnsConfig.cjs");

export const addDNSEntry = dnsConfig.addDNSEntry;
export const removeDNSEntry = dnsConfig.removeDNSEntry;
export const removeAllDNSEntries = dnsConfig.removeAllDNSEntries;
export const removeAllDNSEntriesSync = dnsConfig.removeAllDNSEntriesSync;
export const checkAllDNSStatus = dnsConfig.checkAllDNSStatus;
export const TOOL_HOSTS = dnsConfig.TOOL_HOSTS;
export const isSudoAvailable = dnsConfig.isSudoAvailable;
export const isSudoPasswordRequired = dnsConfig.isSudoPasswordRequired;
export const execWithPassword = dnsConfig.execWithPassword;

export default dnsConfig;

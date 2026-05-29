/**
 * Get consistent machine ID (browser-safe version).
 * Uses a persistent random ID stored in localStorage.
 * 
 * @returns {Promise<string>} Machine ID (16-character hex)
 */
export async function getConsistentMachineId() {
  try {
    const KEY = "__donix_machine_id";
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, "").substring(0, 16);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch (error) {
    console.log('Error getting machine ID:', error);
    // Fallback to random ID if node-machine-id fails
    return crypto.randomUUID ? crypto.randomUUID() : 
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
  }
}

/**
 * Get raw machine ID without hashing (for debugging purposes)
 * @returns {Promise<string>} Raw machine ID
 */
export async function getRawMachineId() {
  // For server-side, use raw node-machine-id
  try {
    return machineIdSync();
  } catch (error) {
    console.log('Error getting raw machine ID:', error);
    // Fallback to random ID if node-machine-id fails
    return crypto.randomUUID ? crypto.randomUUID() : 
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
  }
}

/**
 * Check if we're running in browser or server environment
 * @returns {boolean} True if in browser, false if in server
 */
export function isBrowser() {
  return typeof window !== 'undefined';
}

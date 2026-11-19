// Vitest stand-in for the plugin's virtual module (which only exists inside a Vite build).
import type { RegisterSWOptions } from "vite-plugin-pwa/types";

/** What the app passed to registerSW, and how often it switched (tests read these). */
export const registered: { options: RegisterSWOptions | null; updates: number } = { options: null, updates: 0 };

export function registerSW(options: RegisterSWOptions = {}) {
  registered.options = options;
  return async (_reloadPage?: boolean) => {
    registered.updates++;
  };
}

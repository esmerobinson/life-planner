// "Is it really her?" before a pairing code is shown (review I2, 2026-11-17).
//
// A v2 code hands over the journal secret, which never changes, at one tap. In the Mac app the
// shell asks for Touch ID or, as the fallback, the Mac login password (LocalAuthentication,
// policy deviceOwnerAuthentication; mac/Esmeworld/main.swift, DeviceOwnerBridge). That is the
// Mac's own lock, not her Esmeworld passphrase. On the web and the iPhone home-screen app there
// is no such bridge: a deliberate tap, and the code hides by itself (Pairing.tsx).
//
// A Mac app too old to have the check never shows a code without it ("unavailable").

export const DEVICE_OWNER_HANDLER = "esmeworldDeviceOwner";
/** Present in every Mac app build (the reminders bridge): tells the Mac app from a browser. */
const MAC_APP_HANDLER = "esmeworldReminders";

export type OwnerCheck = "not-needed" | "ok" | "refused" | "unavailable";

interface ReplyHandler {
  postMessage(message: unknown): Promise<unknown>;
}

function handlers(): Record<string, ReplyHandler | undefined> | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { webkit?: { messageHandlers?: Record<string, ReplyHandler | undefined> } };
  return w.webkit?.messageHandlers ?? null;
}

/** Asks the Mac app to check it's her. Never throws. */
export async function confirmDeviceOwner(): Promise<OwnerCheck> {
  const h = handlers();
  const owner = h?.[DEVICE_OWNER_HANDLER];
  if (!owner) return h?.[MAC_APP_HANDLER] ? "unavailable" : "not-needed";
  try {
    const reply = await owner.postMessage({ action: "confirm" });
    return typeof reply === "object" && reply !== null && (reply as { ok?: unknown }).ok === true ? "ok" : "refused";
  } catch {
    return "refused";
  }
}

/**
 * Whether the window has focus, waiting up to `ms` for it to come back (after the Mac's
 * Touch ID sheet, the window gets focus back a moment later; a code shown before that would be
 * hidden at once by the "window lost focus" rule, or shown to nobody).
 */
export function windowFocused(ms: number): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  if (document.hasFocus()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("focus", done);
      resolve(document.hasFocus());
    };
    const timer = setTimeout(done, ms);
    window.addEventListener("focus", done);
  });
}

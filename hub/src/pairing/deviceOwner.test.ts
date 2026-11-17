import { vi } from "vitest";
import { confirmDeviceOwner, DEVICE_OWNER_HANDLER, windowFocused } from "./deviceOwner";

// Review I2 (2026-11-17): in the Mac app, showing a pairing code needs Touch ID or the Mac login
// password (the shell's LocalAuthentication bridge). Mocked here.

type W = { webkit?: { messageHandlers?: Record<string, unknown> } };
afterEach(() => {
  Reflect.deleteProperty(window as W, "webkit");
  vi.restoreAllMocks();
});

function mac(handlers: Record<string, unknown>) {
  (window as W).webkit = { messageHandlers: handlers };
}

describe("confirmDeviceOwner", () => {
  it("in a browser or the phone (no Mac app): not needed", async () => {
    expect(await confirmDeviceOwner()).toBe("not-needed");
  });

  it("in the Mac app: asks the shell, and only a plain yes counts", async () => {
    const postMessage = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: "yes" }).mockRejectedValueOnce(new Error("cancelled"));
    mac({ [DEVICE_OWNER_HANDLER]: { postMessage }, esmeworldReminders: { postMessage: vi.fn() } });
    expect(await confirmDeviceOwner()).toBe("ok");
    expect(postMessage).toHaveBeenCalledWith({ action: "confirm" });
    expect(await confirmDeviceOwner()).toBe("refused");
    expect(await confirmDeviceOwner()).toBe("refused");
    expect(await confirmDeviceOwner()).toBe("refused");
  });

  it("a Mac app too old to have the check: unavailable (never shown without it)", async () => {
    mac({ esmeworldReminders: { postMessage: vi.fn() } });
    expect(await confirmDeviceOwner()).toBe("unavailable");
  });
});

describe("windowFocused", () => {
  it("true at once when focused; otherwise waits for focus, up to the limit", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    expect(await windowFocused(50)).toBe(true);
    const has = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    expect(await windowFocused(50)).toBe(false);
    const p = windowFocused(2000);
    has.mockReturnValue(true);
    window.dispatchEvent(new Event("focus"));
    expect(await p).toBe(true);
  });
});

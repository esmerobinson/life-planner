import { vi } from "vitest";
import { requestPersistence } from "./storage";

afterEach(() => vi.unstubAllGlobals());

describe("requestPersistence", () => {
  it("requestPersistence returns unsupported when navigator.storage is absent and never throws", async () => {
    vi.stubGlobal("navigator", {});
    expect(await requestPersistence()).toBe("unsupported");
    vi.stubGlobal("navigator", { storage: {} });
    expect(await requestPersistence()).toBe("unsupported");
    vi.stubGlobal("navigator", { storage: { persist: () => Promise.reject(new Error("no")) } });
    await expect(requestPersistence()).resolves.toBe("unsupported");
    vi.stubGlobal("navigator", { storage: { persist: () => { throw new Error("sync"); } } });
    await expect(requestPersistence()).resolves.toBe("unsupported");
  });

  it("maps the browser answer", async () => {
    vi.stubGlobal("navigator", { storage: { persist: async () => true } });
    expect(await requestPersistence()).toBe("persisted");
    vi.stubGlobal("navigator", { storage: { persist: async () => false } });
    expect(await requestPersistence()).toBe("not-persisted");
  });
});

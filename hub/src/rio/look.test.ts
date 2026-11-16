import { renderHook, waitFor } from "@testing-library/react";
import { RAIN_CODES, RIO, clockLook, fetchRioWeather, lookFrom, rioHour, useRioLook } from "./look";

const at = (iso: string) => new Date(iso);

describe("Rio's clock", () => {
  it("rioHour is the hour in Rio", () => {
    expect(rioHour(at("2026-11-14T21:30:00Z"))).toBe(18);
    expect(rioHour(at("2026-11-15T02:59:00Z"))).toBe(23);
    expect(rioHour(at("2026-11-15T03:00:00Z"))).toBe(0);
    expect(RIO.timeZone).toBe("America/Sao_Paulo");
  });

  it("night runs from 18:00 until 06:00 Rio time", () => {
    expect(clockLook(at("2026-11-14T15:00:00Z"))).toBe("day"); // 12:00 in Rio
    expect(clockLook(at("2026-11-14T08:59:00Z"))).toBe("night"); // 05:59
    expect(clockLook(at("2026-11-14T09:00:00Z"))).toBe("day"); // 06:00
    expect(clockLook(at("2026-11-14T21:00:00Z"))).toBe("night"); // 18:00
  });
});

describe("the look", () => {
  const noon = at("2026-11-14T15:00:00Z");
  it("rain in the day, night after dark (rain at night shows night), day otherwise", () => {
    expect(lookFrom({ isDay: true, code: 61 }, noon)).toBe("rain");
    expect(lookFrom({ isDay: false, code: 61 }, noon)).toBe("night");
    expect(lookFrom({ isDay: true, code: 2 }, noon)).toBe("day");
    for (const c of [51, 67, 80, 82, 95, 99]) expect(RAIN_CODES.has(c)).toBe(true);
    for (const c of [0, 3, 45, 50, 68, 79, 83, 94]) expect(RAIN_CODES.has(c)).toBe(false);
  });

  it("with no weather (service down or offline), the look comes from Rio's clock, never rain", () => {
    expect(lookFrom(null, at("2026-11-14T21:30:00Z"))).toBe("night");
    expect(lookFrom(null, noon)).toBe("day");
  });
});

describe("fetching Rio's weather", () => {
  it("a fetch that fails gives null", async () => {
    expect(await fetchRioWeather(() => Promise.reject(new Error("offline")))).toBeNull();
    expect(await fetchRioWeather(() => Promise.resolve(new Response("nope", { status: 500 })))).toBeNull();
    expect(await fetchRioWeather(() => Promise.resolve(new Response("{}")))).toBeNull();
  });

  it("reads the current weather code and day flag; the request carries only Rio's fixed coordinates", async () => {
    const urls: string[] = [];
    const inits: (RequestInit | undefined)[] = [];
    const f = (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      inits.push(init);
      return Promise.resolve(new Response(JSON.stringify({ current: { weather_code: 80, is_day: 1 } })));
    };
    expect(await fetchRioWeather(f)).toEqual({ isDay: true, code: 80 });
    expect(urls).toEqual([
      "https://api.open-meteo.com/v1/forecast?latitude=-22.98&longitude=-43.2&current=weather_code,is_day&timezone=America%2FSao_Paulo",
    ]);
    // Nothing else goes with it: no headers, no body, no cookies.
    expect(inits[0]?.headers).toBeUndefined();
    expect(inits[0]?.body).toBeUndefined();
    expect(inits[0]?.credentials).toBe("omit");
  });
});

describe("useRioLook", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("follows the weather service, and caches it for half an hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("2026-11-14T15:00:00Z"));
    const fetchFn = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ current: { weather_code: 63, is_day: 1 } }))));
    vi.stubGlobal("fetch", fetchFn);
    const { result, unmount } = renderHook(() => useRioLook());
    await waitFor(() => expect(result.current).toBe("rain"));
    unmount();
    const again = renderHook(() => useRioLook());
    expect(again.result.current).toBe("rain"); // from the cache, at once
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("with the service down, shows Rio's clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("2026-11-14T23:00:00Z"));
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    const { result } = renderHook(() => useRioLook());
    expect(result.current).toBe("night");
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe("night");
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { RAIN_CODES, devDay, devGoal, devNight, RIO, clockLook, devLook, fetchRioWeather, lookFrom, rioHour, useRioLook } from "./look";

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

  it("asks again every half hour, never reusing the cache then (review: night could lag up to an hour)", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval"] });
    vi.setSystemTime(at("2026-11-14T20:40:00Z")); // 17:40 in Rio: still day
    let isDay = 1;
    const fetchFn = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ current: { weather_code: 2, is_day: isDay } }))));
    vi.stubGlobal("fetch", fetchFn);
    const { result } = renderHook(() => useRioLook());
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    expect(result.current).toBe("day");
    isDay = 0; // the sun sets
    await act(async () => {
      vi.advanceTimersByTime(30 * 60_000);
    });
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current).toBe("night"));
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

describe("devLook (development builds only: to look at night and rain on demand)", () => {
  it("reads ?look= in development, and never in a real build", () => {
    expect(devLook("?look=night", true)).toBe("night");
    expect(devLook("?look=rain", true)).toBe("rain");
    expect(devLook("?look=snow", true)).toBeNull();
    expect(devLook("", true)).toBeNull();
    expect(devLook("?look=rain", false)).toBeNull();
  });
});

describe("dev-only overrides for screenshots", () => {
  it("?day=N jumps the farm day in dev only", () => {
    expect(devDay("?day=14", true)).toBe(14);
    expect(devDay("?day=14", false)).toBeNull();
    expect(devDay("?day=0", true)).toBeNull();
    expect(devDay("?day=abc", true)).toBeNull();
    expect(devDay("", true)).toBeNull();
  });
  it("?night=<theme> previews a boteco themed night in dev only", () => {
    expect(devNight("?night=samba", true)).toBe("samba");
    expect(devNight("?night=football", true)).toBe("football");
    expect(devNight("?night=quiz", true)).toBeNull();
    expect(devNight("?night=samba", false)).toBeNull();
  });
});

it("?goal=1 previews the match's goal moment in dev only", () => {
  expect(devGoal("?goal=1", true)).toBe(true);
  expect(devGoal("?goal=1", false)).toBe(false);
  expect(devGoal("", true)).toBe(false);
});

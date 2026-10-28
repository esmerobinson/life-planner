import { db } from "../data/db";
import {
  BOARD_META_KEY,
  DEFAULT_BOARD,
  describeAge,
  fetchBoard,
  isStale,
  parseBoardInput,
  PINS_META_KEY,
  readBoardSetting,
  readCachedBoard,
  safePins,
  saveBoardSetting,
  STALE_MS,
} from "./board";

// Fictional pins only.
const PINS = [
  { img: "https://i.pinimg.com/736x/aa/fictional1.jpg", link: "https://www.pinterest.com/pin/fictional-1/" },
  { img: "https://i.pinimg.com/736x/aa/fictional2.jpg", link: "https://www.pinterest.com/pin/fictional-2/" },
];
const ADDRESS = "https://sync.example.test";
const TOKEN = "f".repeat(64);

beforeEach(async () => {
  await db.syncMeta.clear();
});

async function configure() {
  await db.syncMeta.bulkPut([
    { key: "serverUrl", value: ADDRESS },
    { key: "token", value: TOKEN },
  ]);
}

function respond(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe("parseBoardInput", () => {
  it.each([
    ["esmelrobinson/visionboardfuture", "esmelrobinson/visionboardfuture"],
    ["  someone/my-board  ", "someone/my-board"],
    ["https://www.pinterest.com/esmelrobinson/visionboardfuture/", "esmelrobinson/visionboardfuture"],
    ["https://pinterest.com/someone/board_2", "someone/board_2"],
    ["pinterest.com/someone/board", "someone/board"],
    ["www.pinterest.co.uk/someone/board/", "someone/board"],
    ["https://uk.pinterest.com/someone/board/?invite_code=abc#x", "someone/board"],
    ["https://www.pinterest.com/someone/board.rss", "someone/board"],
    ["https://www.pinterest.com/someone/board/a-section/", "someone/board"],
    ["/someone/board/", "someone/board"],
  ])("reads %j as %j", (text, board) => {
    expect(parseBoardInput(text)).toEqual({ ok: true, board });
  });

  it.each(["https://pin.it/abc123", "pin.it/abc123", "http://pin.it/x"])("explains that %j short links cannot be read", (text) => {
    expect(parseBoardInput(text)).toEqual({ ok: false, reason: "short-link" });
  });

  it.each([
    "",
    "   ",
    "someone",
    "https://www.pinterest.com/pin/12345/",
    "https://evil.example/someone/board",
    "https://pinterest.com.evil.example/someone/board",
    "javascript:alert(1)",
    "some one/board",
    "someone/bo.ard",
    `${"u".repeat(65)}/board`,
  ])("refuses %j", (text) => {
    expect(parseBoardInput(text)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("safePins", () => {
  it("keeps only pinimg images and pinterest links, as plain {img, link}", () => {
    expect(
      safePins([
        PINS[0],
        { img: "https://evil.example/x.jpg", link: PINS[1]!.link },
        { img: PINS[1]!.img, link: "javascript:alert(1)" },
        { img: "http://i.pinimg.com/x.jpg", link: PINS[1]!.link },
        { img: PINS[1]!.img, link: "https://pinterest.com/pin/ok/", extra: "dropped" },
        null,
        "nope",
      ]),
    ).toEqual([PINS[0], { img: PINS[1]!.img, link: "https://pinterest.com/pin/ok/" }]);
    expect(safePins("not a list")).toEqual([]);
  });
});

describe("describeAge", () => {
  const now = 1_790_000_000_000;
  it.each([
    [0, "just now"],
    [59_000, "just now"],
    [60_000, "1 min ago"],
    [5 * 60_000 + 10_000, "5 min ago"],
    [59 * 60_000, "59 min ago"],
    [60 * 60_000, "1 hour ago"],
    [3 * 60 * 60_000, "3 hours ago"],
    [24 * 60 * 60_000, "1 day ago"],
    [9 * 24 * 60 * 60_000, "9 days ago"],
    [-5 * 60_000, "just now"],
  ])("%d ms ago reads %j", (ago, text) => {
    expect(describeAge(now - ago, now)).toBe(text);
  });
});

describe("board setting", () => {
  it("defaults to Esme's board and remembers a new one in syncMeta", async () => {
    expect(DEFAULT_BOARD).toBe("esmelrobinson/visionboardfuture");
    expect(BOARD_META_KEY).toBe("visionBoard");
    expect(await readBoardSetting(db)).toBe(DEFAULT_BOARD);
    await saveBoardSetting(db, "someone/else");
    expect(await readBoardSetting(db)).toBe("someone/else");
    expect((await db.syncMeta.get("visionBoard"))?.value).toBe("someone/else");
  });

  it("ignores a stored value that is not a valid board", async () => {
    await db.syncMeta.put({ key: BOARD_META_KEY, value: "../../x" });
    expect(await readBoardSetting(db)).toBe(DEFAULT_BOARD);
  });
});

describe("isStale", () => {
  it("is stale at 15 minutes", () => {
    expect(STALE_MS).toBe(15 * 60 * 1000);
    expect(isStale(1000, 1000 + STALE_MS - 1)).toBe(false);
    expect(isStale(1000, 1000 + STALE_MS)).toBe(true);
    expect(isStale(1000 + 60_000, 1000)).toBe(true); // a clock that went backwards: ask again
  });
});

describe("fetchBoard", () => {
  it("says so when sync is not set up, without fetching", async () => {
    const { fetchFn } = respond(200, {});
    expect(await fetchBoard({ db, fetch: fetchFn }, DEFAULT_BOARD)).toEqual({ kind: "not-configured" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("asks the sync server with the token and stores the pins", async () => {
    await configure();
    const { fetchFn, calls } = respond(200, { board: "someone/b-1", fetchedAt: 123, pins: PINS });
    const out = await fetchBoard({ db, fetch: fetchFn }, "someone/b-1");
    expect(out).toEqual({ kind: "ok", board: { board: "someone/b-1", fetchedAt: 123, pins: PINS } });
    expect(calls[0]!.url).toBe(`${ADDRESS}/v1/pinterest-board?board=someone%2Fb-1`);
    expect(new Headers(calls[0]!.init?.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(await readCachedBoard(db)).toEqual({ board: "someone/b-1", fetchedAt: 123, pins: PINS });
    expect(PINS_META_KEY).toBe("visionPins");
  });

  it("filters what the server sent", async () => {
    await configure();
    const { fetchFn } = respond(200, { board: DEFAULT_BOARD, fetchedAt: 5, pins: [PINS[0], { img: "https://evil.example/x", link: PINS[1]!.link }] });
    const out = await fetchBoard({ db, fetch: fetchFn }, DEFAULT_BOARD);
    expect(out).toEqual({ kind: "ok", board: { board: DEFAULT_BOARD, fetchedAt: 5, pins: [PINS[0]] } });
  });

  it.each([
    [401, "needs-passphrase"],
    [429, "rate-limited"],
    [502, "unavailable"],
    [500, "failed"],
    [400, "failed"],
  ])("reports %d as %s and keeps the stored board", async (status, kind) => {
    await configure();
    await db.syncMeta.put({ key: PINS_META_KEY, value: { board: DEFAULT_BOARD, fetchedAt: 1, pins: PINS } });
    const { fetchFn } = respond(status, { error: "x" });
    expect(await fetchBoard({ db, fetch: fetchFn }, DEFAULT_BOARD)).toEqual({ kind });
    expect(await readCachedBoard(db)).toEqual({ board: DEFAULT_BOARD, fetchedAt: 1, pins: PINS });
    // It never touches the sync settings (the sync run handles a refused token itself).
    expect((await db.syncMeta.get("token"))?.value).toBe(TOKEN);
  });

  it("reports offline when the server cannot be reached, and failed on a malformed answer", async () => {
    await configure();
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await fetchBoard({ db, fetch: offline }, DEFAULT_BOARD)).toEqual({ kind: "offline" });
    expect(await fetchBoard({ db, fetch: respond(200, "not json").fetchFn }, DEFAULT_BOARD)).toEqual({ kind: "failed" });
    expect(await fetchBoard({ db, fetch: respond(200, { board: "other/board", fetchedAt: 1, pins: [] }).fetchFn }, DEFAULT_BOARD)).toEqual({
      kind: "failed",
    });
    expect(await readCachedBoard(db)).toBeNull();
  });

  it("refuses a board name that is not valid without fetching", async () => {
    await configure();
    const { fetchFn } = respond(200, {});
    expect(await fetchBoard({ db, fetch: fetchFn }, "../x")).toEqual({ kind: "failed" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("readCachedBoard", () => {
  it("ignores something stored that is not a board", async () => {
    await db.syncMeta.put({ key: PINS_META_KEY, value: "garbage" });
    expect(await readCachedBoard(db)).toBeNull();
    await db.syncMeta.put({ key: PINS_META_KEY, value: { board: DEFAULT_BOARD, fetchedAt: "x", pins: [] } });
    expect(await readCachedBoard(db)).toBeNull();
  });
});

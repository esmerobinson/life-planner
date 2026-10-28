import { describe, expect, it } from "vitest";
import {
  BOARD_CACHE_MS,
  MAX_FEED_BYTES,
  parseBoardFeed,
  PINTEREST_TIMEOUT_MS,
  upstreamFeedUrl,
} from "../../src/pinterest";
import { call, errorOf, T0, type CallOptions } from "./helpers";
import { FIXTURE_BOARD, FIXTURE_ITEMS, FIXTURE_PINS, FIXTURE_RSS, pinItem, rssFeed } from "./pinterestFixture";

interface BoardBody {
  board: string;
  fetchedAt: number;
  pins: { img: string; link: string }[];
}

interface Upstream {
  fetch: typeof fetch;
  requests: Request[];
}

/** A stand-in for Pinterest: records each request and answers with `respond`. */
function upstream(respond: (request: Request) => Response | Promise<Response> = () => feedResponse(FIXTURE_RSS)): Upstream {
  const requests: Request[] = [];
  return {
    requests,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      return respond(request);
    }) as typeof fetch,
  };
}

function feedResponse(body: BodyInit, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" }, ...init });
}

/** A fresh, private cache per test, so tests never see each other's boards. */
async function freshCache(): Promise<Cache> {
  return caches.open(`pinterest-test-${crypto.randomUUID()}`);
}

async function board(query: string, up: Upstream, cache: Cache | null, opts: CallOptions = {}): Promise<Response> {
  return call(`/v1/pinterest-board${query}`, {
    ...opts,
    deps: { upstreamFetch: up.fetch, boardCache: cache, ...opts.deps },
  });
}

const q = (b: string) => `?board=${encodeURIComponent(b)}`;

describe("GET /v1/pinterest-board", () => {
  it("returns the board's pins with sharper images and pin links", async () => {
    const up = upstream();
    const response = await board(q(FIXTURE_BOARD), up, await freshCache());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ board: FIXTURE_BOARD, fetchedAt: T0, pins: FIXTURE_PINS });
  });

  it("only ever fetches https://www.pinterest.com/<board>.rss, with a User-Agent, no credentials", async () => {
    const up = upstream();
    await board(q(FIXTURE_BOARD), up, await freshCache());
    expect(up.requests).toHaveLength(1);
    const sent = up.requests[0]!;
    expect(sent.url).toBe("https://www.pinterest.com/fictionaluser/dreamboard.rss");
    expect(sent.method).toBe("GET");
    expect(sent.headers.get("User-Agent")).toBeTruthy();
    expect(sent.headers.get("Authorization")).toBeNull();
    expect(sent.headers.get("Cookie")).toBeNull();
    expect(sent.redirect).toBe("manual");
    expect(upstreamFeedUrl("a/b")).toBe("https://www.pinterest.com/a/b.rss");
  });

  it("requires the sync token (it is not an open proxy) and never contacts Pinterest without it", async () => {
    const up = upstream();
    const missing = await board(q(FIXTURE_BOARD), up, await freshCache(), { token: null });
    expect(missing.status).toBe(401);
    expect(await errorOf(missing)).toBe("unauthorized");
    const wrong = await board(q(FIXTURE_BOARD), up, await freshCache(), { token: "wrong-token-not-real", ip: "203.0.113.77" });
    expect(wrong.status).toBe(401);
    expect(up.requests).toHaveLength(0);
  });

  it("counts failed tokens in the same rate limit as sync", async () => {
    const up = upstream();
    const cache = await freshCache();
    const ip = "198.51.100.40";
    for (let i = 0; i < 5; i++) {
      expect((await board(q(FIXTURE_BOARD), up, cache, { token: "wrong-token-not-real", ip })).status).toBe(401);
    }
    const locked = await board(q(FIXTURE_BOARD), up, cache, { ip });
    expect(locked.status).toBe(429);
    expect(await errorOf(locked)).toBe("rate_limited");
    // And the sync endpoint shares that lock.
    const syncLocked = await call("/v1/sync", { method: "POST", body: { deviceId: "device-aaaa", cursor: 0, changes: [] }, ip });
    expect(syncLocked.status).toBe(429);
    expect(up.requests).toHaveLength(0);
  });

  it("only answers GET (and preflight)", async () => {
    const up = upstream();
    const post = await board(q(FIXTURE_BOARD), up, await freshCache(), { method: "POST", body: {} });
    expect(post.status).toBe(405);
    expect(post.headers.get("Allow")).toBe("GET, OPTIONS");
    const preflight = await board(q(FIXTURE_BOARD), up, await freshCache(), {
      method: "OPTIONS",
      origin: "esmeworld://app",
      token: null,
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("esmeworld://app");
  });

  it("sends CORS headers to the app's origins", async () => {
    const response = await board(q(FIXTURE_BOARD), upstream(), await freshCache(), { origin: "https://life-hub-eoy.pages.dev" });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://life-hub-eoy.pages.dev");
  });

  it.each([
    ["missing", ""],
    ["empty", q("")],
    ["no slash", q("fictionaluser")],
    ["three parts", q("a/b/c")],
    ["path traversal", q("../etc/passwd")],
    ["dot segments", q("a/..")],
    ["encoded slash", "?board=a%2F..%2F..%2Fx"],
    ["a full URL", q("https://evil.example/a/b")],
    ["a host", q("evil.example/b")],
    ["query smuggling", q("a/b?x=1")],
    ["fragment", q("a/b#x")],
    ["spaces", q("a /b")],
    ["unicode", q("ä/b")],
    ["too long user", q(`${"u".repeat(65)}/b`)],
    ["too long board", q(`a/${"b".repeat(101)}`)],
    ["leading slash", q("/a/b")],
    ["two board params", `${q("a/b")}&board=c/d`],
  ])("rejects a bad board name (%s) with 400 bad_board and never fetches", async (_name, query) => {
    const up = upstream();
    const response = await board(query, up, await freshCache());
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe("bad_board");
    expect(up.requests).toHaveLength(0);
  });

  it("accepts the longest allowed names", async () => {
    const name = `${"u".repeat(64)}/${"b".repeat(100)}`;
    const up = upstream();
    const response = await board(q(name), up, await freshCache());
    expect(response.status).toBe(200);
    expect(up.requests[0]!.url).toBe(`https://www.pinterest.com/${name}.rss`);
  });

  it("drops pins whose image is not on https://i.pinimg.com/ or whose link is not a pinterest.com page", async () => {
    const good = pinItem("fictional_Pin-0001", "aa/bb/cc/aabbcc0001");
    const hostile = [
      { link: "javascript:alert(1)", html: '<a href="javascript:alert(1)"><img src="https://i.pinimg.com/236x/x/1.jpg"></a>' },
      { link: "https://www.pinterest.com/pin/2/", html: '<img src="http://i.pinimg.com/236x/x/2.jpg">' },
      { link: "https://www.pinterest.com/pin/3/", html: '<img src="https://evil.example/236x/x/3.jpg">' },
      { link: "https://www.pinterest.com/pin/4/", html: '<img src="https://i.pinimg.com.evil.example/236x/x/4.jpg">' },
      { link: "https://www.pinterest.com/pin/5/", html: '<img src="https://user:pw@i.pinimg.com/236x/x/5.jpg">' },
      { link: "https://www.pinterest.com/pin/6/", html: '<img src="https://i.pinimg.com:8443/236x/x/6.jpg">' },
      { link: "https://www.pinterest.com/pin/7/", html: '<img src="javascript:alert(7)">' },
      { link: "https://www.pinterest.com/pin/8/", html: '<img src="data:image/png;base64,AAAA">' },
      { link: "https://pinterest.com.evil.example/pin/9/", html: '<img src="https://i.pinimg.com/236x/x/9.jpg">' },
      { link: "http://www.pinterest.com/pin/10/", html: '<img src="https://i.pinimg.com/236x/x/10.jpg">' },
      { link: "data:text/html,hi", html: '<img src="https://i.pinimg.com/236x/x/11.jpg">' },
      { link: "https://www.pinterest.com/pin/12/", html: "no image here" },
      { link: "", html: '<img src="https://i.pinimg.com/236x/x/13.jpg">' },
      { link: "https://www.pinterest.com/pin/14/", html: '<img src="//i.pinimg.com/236x/x/14.jpg">' },
      { link: "https://www.pinterest.com/pin/15/", html: '<img src="https://i.pinimg.com/236x/x/15.jpg" onerror="alert(1)">' },
    ];
    const up = upstream(() => feedResponse(rssFeed([good, ...hostile])));
    const body = (await (await board(q(FIXTURE_BOARD), up, await freshCache())).json()) as BoardBody;
    expect(body.pins).toEqual([
      FIXTURE_PINS[0],
      // Only the attribute value is kept: the extra attribute never reaches the client.
      { img: "https://i.pinimg.com/736x/x/15.jpg", link: "https://www.pinterest.com/pin/15/" },
    ]);
  });

  it("accepts https://pinterest.com/ links and keeps image URLs that are not 236x as they are", async () => {
    const items = [
      { link: "https://pinterest.com/pin/1/", html: "<img src='https://i.pinimg.com/originals/a/b.png'>" },
      { link: "https://www.pinterest.com/pin/2/", html: '<img alt="" src="https://i.pinimg.com/236x/c/d.jpg?x=1">' },
    ];
    const up = upstream(() => feedResponse(rssFeed(items)));
    const body = (await (await board(q(FIXTURE_BOARD), up, await freshCache())).json()) as BoardBody;
    expect(body.pins).toEqual([
      { img: "https://i.pinimg.com/originals/a/b.png", link: "https://pinterest.com/pin/1/" },
      { img: "https://i.pinimg.com/736x/c/d.jpg?x=1", link: "https://www.pinterest.com/pin/2/" },
    ]);
  });

  it("returns an empty list for a board with no pins", async () => {
    const up = upstream(() => feedResponse(rssFeed([])));
    const body = (await (await board(q(FIXTURE_BOARD), up, await freshCache())).json()) as BoardBody;
    expect(body.pins).toEqual([]);
  });

  it("reads CDATA descriptions and numeric entities", async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
      <item><link>https://www.pinterest.com/pin/c1/</link><description><![CDATA[<a href="x"><img src="https://i.pinimg.com/236x/c/1.jpg"></a>]]></description></item>
      <item><link>https://www.pinterest.com/pin/c2/</link><description>&#60;img src=&#x22;https://i.pinimg.com/236x/c/2.jpg&#34;&#62;</description></item>
    </channel></rss>`;
    const up = upstream(() => feedResponse(xml));
    const body = (await (await board(q(FIXTURE_BOARD), up, await freshCache())).json()) as BoardBody;
    expect(body.pins).toEqual([
      { img: "https://i.pinimg.com/736x/c/1.jpg", link: "https://www.pinterest.com/pin/c1/" },
      { img: "https://i.pinimg.com/736x/c/2.jpg", link: "https://www.pinterest.com/pin/c2/" },
    ]);
  });

  it.each([
    ["404", () => new Response("not found", { status: 404 })],
    ["500", () => new Response("oops", { status: 500 })],
    ["a redirect (never followed)", () => new Response(null, { status: 302, headers: { Location: "https://evil.example/" } })],
    ["HTML instead of RSS", () => feedResponse("<!doctype html><html><body>Log in</body></html>")],
    ["an empty body", () => feedResponse("")],
    ["a network error", () => Promise.reject(new TypeError("network down"))],
  ])("answers 502 pinterest_unavailable on %s", async (_name, respond) => {
    const response = await board(q(FIXTURE_BOARD), upstream(respond), await freshCache());
    expect(response.status).toBe(502);
    expect(await errorOf(response)).toBe("pinterest_unavailable");
  });

  it("refuses a feed over 2 MB, by declared length or by actual size", async () => {
    expect(MAX_FEED_BYTES).toBe(2 * 1024 * 1024);
    const big = FIXTURE_RSS.replace("<language>", `<!--${"x".repeat(MAX_FEED_BYTES)}--><language>`);
    const declared = upstream(() => feedResponse("x", { headers: { "Content-Length": String(MAX_FEED_BYTES + 1) } }));
    const r1 = await board(q(FIXTURE_BOARD), declared, await freshCache());
    expect(r1.status).toBe(502);
    expect(await errorOf(r1)).toBe("pinterest_unavailable");

    // Streamed with no Content-Length: cut off once it passes the limit.
    const streamed = upstream(() => {
      const bytes = new TextEncoder().encode(big);
      let offset = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.length) return controller.close();
          controller.enqueue(bytes.slice(offset, offset + 65536));
          offset += 65536;
        },
      });
      return feedResponse(stream);
    });
    const r2 = await board(q(FIXTURE_BOARD), streamed, await freshCache());
    expect(r2.status).toBe(502);
    expect(await errorOf(r2)).toBe("pinterest_unavailable");
  });

  it("gives up after the timeout when Pinterest hangs, including mid-body", async () => {
    expect(PINTEREST_TIMEOUT_MS).toBe(5000);
    const hangs = upstream(() => new Promise<Response>(() => undefined));
    const r1 = await board(q(FIXTURE_BOARD), hangs, await freshCache(), { deps: { upstreamTimeoutMs: 50 } });
    expect(r1.status).toBe(502);
    expect(await errorOf(r1)).toBe("pinterest_unavailable");

    const stalls = upstream(() => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("<?xml version='1.0'?><rss><channel>"));
        },
      });
      return feedResponse(stream);
    });
    const r2 = await board(q(FIXTURE_BOARD), stalls, await freshCache(), { deps: { upstreamTimeoutMs: 50 } });
    expect(r2.status).toBe(502);
  });

  it("caches a board for 15 minutes, then fetches it again", async () => {
    expect(BOARD_CACHE_MS).toBe(15 * 60 * 1000);
    const cache = await freshCache();
    let n = 0;
    const up = upstream(() => feedResponse(rssFeed(FIXTURE_ITEMS.slice(0, ++n))));
    const first = (await (await board(q(FIXTURE_BOARD), up, cache)).json()) as BoardBody;
    expect(first.pins).toHaveLength(1);
    const second = (await (await board(q(FIXTURE_BOARD), up, cache, { now: T0 + BOARD_CACHE_MS - 1 })).json()) as BoardBody;
    expect(second).toEqual(first); // same fetchedAt: served from the cache
    expect(up.requests).toHaveLength(1);
    const third = (await (await board(q(FIXTURE_BOARD), up, cache, { now: T0 + BOARD_CACHE_MS })).json()) as BoardBody;
    expect(third.pins).toHaveLength(2);
    expect(third.fetchedAt).toBe(T0 + BOARD_CACHE_MS);
    expect(up.requests).toHaveLength(2);
  });

  it("keys the cache by board, and never caches failures", async () => {
    const cache = await freshCache();
    let fail = true;
    const up = upstream(() => (fail ? new Response("down", { status: 503 }) : feedResponse(FIXTURE_RSS)));
    expect((await board(q(FIXTURE_BOARD), up, cache)).status).toBe(502);
    fail = false;
    expect((await board(q(FIXTURE_BOARD), up, cache)).status).toBe(200);
    expect((await board(q("someone/else"), up, cache)).status).toBe(200);
    expect(up.requests.map((r) => r.url)).toEqual([
      "https://www.pinterest.com/fictionaluser/dreamboard.rss",
      "https://www.pinterest.com/fictionaluser/dreamboard.rss",
      "https://www.pinterest.com/someone/else.rss",
    ]);
    const other = (await (await board(q("someone/else"), up, cache)).json()) as BoardBody;
    expect(other.board).toBe("someone/else");
    expect(up.requests).toHaveLength(3);
  });

  it("works with no cache available", async () => {
    const up = upstream();
    expect((await board(q(FIXTURE_BOARD), up, null)).status).toBe(200);
    expect((await board(q(FIXTURE_BOARD), up, null)).status).toBe(200);
    expect(up.requests).toHaveLength(2);
  });

  it("never echoes the board or upstream text in errors", async () => {
    const response = await board(q("<script>x</script>"), upstream(), await freshCache());
    const text = await response.text();
    expect(text).toBe('{"error":"bad_board"}');
  });
});

describe("parseBoardFeed", () => {
  it("returns null for something that is not an RSS feed", () => {
    expect(parseBoardFeed("<html></html>")).toBeNull();
    expect(parseBoardFeed("")).toBeNull();
  });

  it("parses the fixture", () => {
    expect(parseBoardFeed(FIXTURE_RSS)).toEqual(FIXTURE_PINS);
  });

  it("drops duplicate pins and caps the list", () => {
    const items = Array.from({ length: 300 }, (_, i) => pinItem(`p${i % 250}`, `h/${i % 250}`));
    const pins = parseBoardFeed(rssFeed(items))!;
    expect(pins.length).toBe(200);
    expect(new Set(pins.map((p) => p.link)).size).toBe(200);
  });
});

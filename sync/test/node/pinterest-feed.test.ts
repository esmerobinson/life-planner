import { describe, expect, it } from "vitest";
import { MAX_PINS, parseBoardFeed } from "../../shared/pinterestFeed.ts";
import { FIXTURE_PINS, FIXTURE_RSS, pinItem, rssFeed } from "../worker/pinterestFixture.ts";

// Runs in Node, not workerd: the Workers runtime freezes clocks during CPU work, so timing
// can only be measured here. Same V8 regex engine as the Worker.

const TWO_MB = 2 * 1024 * 1024;
const HEAD = '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>';

function fill(prefix: string, unit: string, suffix = ""): string {
  return prefix + unit.repeat(Math.ceil((TWO_MB - prefix.length - suffix.length) / unit.length)) + suffix;
}

function timed<T>(fn: () => T): { ms: number; value: T } {
  const start = performance.now();
  const value = fn();
  return { ms: performance.now() - start, value };
}

const HOSTILE: [string, string][] = [
  ["<item> repeated, never closed", fill(HEAD, "<item>")],
  ["<link> repeated, never closed", fill(`${HEAD}<item>`, "<link>", "</item>")],
  ["one description of '<img ' with no '>'", fill(`${HEAD}<item><link>https://www.pinterest.com/pin/1/</link><description>`, "<img ", "</description></item>")],
  ["escaped '&lt;img ' with no '&gt;'", fill(`${HEAD}<item><link>https://www.pinterest.com/pin/1/</link><description>`, "&lt;img ", "</description></item>")],
  ["one giant <img> of whitespace", fill(`${HEAD}<item><link>https://www.pinterest.com/pin/1/</link><description><img`, " ", "></description></item>")],
  ["src= repeated inside one tag", fill(`${HEAD}<item><link>https://www.pinterest.com/pin/1/</link><description><img`, ' src=" ', "></description></item>")],
  ["deeply nested tags, nothing closed", fill(HEAD, "<item><description><a><b><img <link ", "</item>")],
  ["<description> repeated, never closed", fill(`${HEAD}<item>`, "<description>", "</item>")],
  ["CDATA opened, never closed", fill(`${HEAD}<item><description><![CDATA[`, "<img src='x' ", "</description></item>")],
  ["entities with no ';'", fill(`${HEAD}<item><link>https://www.pinterest.com/pin/1/</link><description>`, "&aaaaaaaaaa")],
  ["'<items' look-alikes", fill(HEAD, "<itemz <item")],
  ["many items whose <link> never closes", fill(HEAD, "<item><link>x</item>")],
  ["many items whose <description> never closes", fill(HEAD, "<item><link>https://www.pinterest.com/pin/1/</link><description>&lt;img</item>")],
  ["2 MB of well-formed pins", rssFeed(Array.from({ length: Math.floor(TWO_MB / 230) }, (_, i) => pinItem(`p${i}`, `h/${i}`)))],
];

describe("parseBoardFeed (linear time)", () => {
  it.each(HOSTILE)("handles %s (2 MB) in well under 50 ms", (_name, xml) => {
    expect(xml.length).toBeGreaterThanOrEqual(TWO_MB - 300);
    parseBoardFeed(xml); // warm up the JIT once
    const { ms, value } = timed(() => parseBoardFeed(xml));
    expect(ms).toBeLessThan(50);
    if (value) expect(value.length).toBeLessThanOrEqual(MAX_PINS);
  });

  it("still parses the real-format fixture exactly", () => {
    expect(parseBoardFeed(FIXTURE_RSS)).toEqual(FIXTURE_PINS);
  });

  it("finds nothing in hostile input that is not a real pin", () => {
    for (const [name, xml] of HOSTILE.slice(0, -1)) expect(parseBoardFeed(xml) ?? [], name).toEqual([]);
  });

  it("reads items, links and images regardless of attribute order and quoting", () => {
    const xml = `${HEAD}
      <item foo="1"><link>https://www.pinterest.com/pin/a/</link><description>&lt;a href=&quot;x&quot;&gt;&lt;img alt=&quot;&quot; src=&quot;https://i.pinimg.com/236x/a.jpg&quot;&gt;</description></item>
      <item><description><![CDATA[<img src='https://i.pinimg.com/236x/b.jpg'>]]></description><link>https://pinterest.com/pin/b/</link></item>
      <itemz><link>https://www.pinterest.com/pin/c/</link><description>&lt;img src=&quot;https://i.pinimg.com/236x/c.jpg&quot;&gt;</description></itemz>
    </channel></rss>`;
    expect(parseBoardFeed(xml)).toEqual([
      { img: "https://i.pinimg.com/736x/a.jpg", link: "https://www.pinterest.com/pin/a/" },
      { img: "https://i.pinimg.com/736x/b.jpg", link: "https://pinterest.com/pin/b/" },
    ]);
  });
});

// A Pinterest board RSS feed in the shape checked against the live feed on 2026-10-28.
// Every pin, board and image here is fictional. Tests never fetch the real feed.

export const FIXTURE_BOARD = "fictionaluser/dreamboard";

export interface FixtureItem {
  link: string;
  /** Raw (unescaped) HTML that goes into <description>, entity-escaped by `rssFeed`. */
  html: string;
}

export function pinItem(id: string, imageHash: string): FixtureItem {
  const link = `https://www.pinterest.com/pin/${id}/`;
  return { link, html: `<a href="${link}"><img src="https://i.pinimg.com/236x/${imageHash}.jpg"></a> ` };
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function rssFeed(items: FixtureItem[], title = "dreamboard"): string {
  const body = items
    .map(
      (item) => `
        <item>
            <title> </title>
            <link>${item.link}</link>
            <description>${escapeXml(item.html)}</description>
            <pubDate>Wed, 28 Oct 2026 19:47:00 GMT</pubDate>
            <guid>${item.link}</guid>
        </item>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?><rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0">
    <channel>
        <title>${title}</title>
        <link>https://www.pinterest.com/fictionaluser/dreamboard</link>
        <description></description>
        <atom:link href="https://www.pinterest.com/fictionaluser/dreamboard.rss" rel="self">
        </atom:link>
        <language>en-us</language>
        <lastBuildDate>Wed, 28 Oct 2026 21:16:27 GMT</lastBuildDate>${body}
    </channel>
</rss>`;
}

/** Three ordinary fictional pins. */
export const FIXTURE_ITEMS: FixtureItem[] = [
  pinItem("fictional_Pin-0001", "aa/bb/cc/aabbcc0001"),
  pinItem("fictional_Pin-0002", "aa/bb/cc/aabbcc0002"),
  pinItem("fictional_Pin-0003", "aa/bb/cc/aabbcc0003"),
];

export const FIXTURE_RSS = rssFeed(FIXTURE_ITEMS);

export const FIXTURE_PINS = [1, 2, 3].map((n) => ({
  img: `https://i.pinimg.com/736x/aa/bb/cc/aabbcc000${n}.jpg`,
  link: `https://www.pinterest.com/pin/fictional_Pin-000${n}/`,
}));

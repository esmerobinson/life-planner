import { describe, expect, it } from "vitest";
import {
  cleanLink, continuation, linkify, parseLine, parsePage, pictureIds, pictureLine, serializePage, toggleCheckLine, withText,
} from "./page";

const roundTrip = (md: string) => serializePage(parsePage(md));

describe("page Markdown round trip", () => {
  it("every block type comes back exactly", () => {
    const md = [
      "# What I know so far",
      "## Smaller heading",
      "He mentioned the flat in Hammersmith.",
      "- [ ] Find the letters box",
      "- [x] Write the questions",
      "* [X] Capital X stays capital",
      "  - [ ] Indented step",
      "- a bullet",
      "* another bullet",
      "+ plus bullet",
      "    - deep bullet",
      "https://example.com/story and obsidian://open?vault=Pretend&file=Notes",
      "[the plan](https://example.com/plan)",
      pictureLine("3f1c2a9e-0000-4000-8000-000000000001"),
      "",
      "Last line",
    ].join("\n");
    expect(roundTrip(md)).toBe(md);
    expect(parsePage(md).map((b) => b.type)).toEqual([
      "h1", "h2", "p", "check", "check", "check", "check", "bullet", "bullet", "bullet", "bullet", "p", "p", "picture", "p", "p",
    ]);
  });

  it("older plain notes and imported notes stay plain lines, untouched", () => {
    const samples = [
      "Check: not sure if this is still open",
      "Get the whole first draft down, rough is fine.\nDone when: Chapter three is finished and sent to a friend",
      "Done when: It exists",
      "line one\n\n\nline after blanks\n",
      "  leading spaces kept\ttabs\t",
      "### three hashes is just text\n#nospace\n-nospace\n- [] not a checkbox\n1. numbered",
      "![](https://example.com/x.png) not a stored picture\n![](file:abc) trailing",
      "",
      "\n",
      "émoji 🌱 and ünïcode",
    ];
    for (const md of samples) {
      expect(roundTrip(md)).toBe(md);
      for (const b of parsePage(md)) if (!/^(#|-|\*|\+|!)/.test(b.prefix + b.text)) expect(b.type).toBe("p");
    }
    expect(parsePage("Check: not sure if this is still open")[0]).toMatchObject({ type: "p", text: "Check: not sure if this is still open" });
  });

  it("empty notes are a single empty paragraph", () => {
    expect(parsePage("")).toEqual([{ type: "p", prefix: "", text: "", indent: 0 }]);
    expect(serializePage(parsePage(""))).toBe("");
  });

  it("reads each kind of line", () => {
    expect(parseLine("# Title")).toMatchObject({ type: "h1", prefix: "# ", text: "Title" });
    expect(parseLine("## Sub")).toMatchObject({ type: "h2", prefix: "## ", text: "Sub" });
    expect(parseLine("- [ ] a")).toMatchObject({ type: "check", done: false, text: "a" });
    expect(parseLine("- [x] a")).toMatchObject({ type: "check", done: true, text: "a" });
    expect(parseLine("- [ ]")).toMatchObject({ type: "check", prefix: "- [ ]", text: "" });
    expect(parseLine("  - b")).toMatchObject({ type: "bullet", indent: 2, text: "b" });
    expect(parseLine("![](file:abc-1)")).toMatchObject({ type: "picture", fileId: "abc-1" });
    expect(parseLine("![a cat](file:abc)")).toMatchObject({ type: "picture", fileId: "abc" });
  });
});

describe("editing helpers", () => {
  it("typed text keeps the marker, with its space", () => {
    expect(withText(parseLine("- [ ]"), "x")).toBe("- [ ] x");
    expect(withText(parseLine("# a"), "b")).toBe("# b");
    expect(withText(parseLine("plain"), "# heading now")).toBe("# heading now");
    expect(withText(parseLine("- [ ] a"), "")).toBe("- [ ] ");
  });

  it("ticks and unticks a checklist line in place, and nothing else changes", () => {
    expect(toggleCheckLine("- [ ] Find the box")).toBe("- [x] Find the box");
    expect(toggleCheckLine("- [x] Find the box")).toBe("- [ ] Find the box");
    expect(toggleCheckLine("  * [X] nested")).toBe("  * [ ] nested");
    expect(toggleCheckLine("Check: not a checkbox")).toBe("Check: not a checkbox");
    const md = "# Plan\n- [ ] one\n- [ ] two";
    const lines = md.split("\n");
    lines[2] = toggleCheckLine(lines[2]!);
    expect(lines.join("\n")).toBe("# Plan\n- [ ] one\n- [x] two");
  });

  it("Enter continues a list with an empty marker, never a heading", () => {
    expect(continuation(parseLine("- [x] done one"))).toBe("- [ ] ");
    expect(continuation(parseLine("  * [ ] nested"))).toBe("  * [ ] ");
    expect(continuation(parseLine("- bullet"))).toBe("- ");
    expect(continuation(parseLine("# Heading"))).toBe("");
    expect(continuation(parseLine("text"))).toBe("");
  });

  it("finds every picture a page refers to", () => {
    expect(pictureIds(`a\n${pictureLine("one")}\nx ![](file:two) y\n![](https://e.com/p.png)`)).toEqual(["one", "two"]);
    expect(pictureIds("")).toEqual([]);
  });
});

describe("links", () => {
  it("bare URLs and obsidian links become links, trailing punctuation stays text", () => {
    const segs = linkify("See https://example.com/a. Then obsidian://open?vault=V&file=F, ok");
    expect(segs.filter((s) => s.kind === "link").map((s) => s.href)).toEqual([
      "https://example.com/a",
      "obsidian://open?vault=V&file=F",
    ]);
    expect(segs.map((s) => s.text).join("")).toBe("See https://example.com/a. Then obsidian://open?vault=V&file=F, ok");
  });

  it("[label](url) shows the label", () => {
    const segs = linkify("read [the plan](https://example.com/plan) now");
    expect(segs).toEqual([
      { kind: "text", text: "read ", start: 0, end: 5, verbatim: true },
      { kind: "link", text: "the plan", href: "https://example.com/plan", start: 5, end: 41, verbatim: false },
      { kind: "text", text: " now", start: 41, end: 45, verbatim: true },
    ]);
  });

  it("never links other schemes", () => {
    expect(linkify("javascript:alert(1) and [x](javascript:alert(1))").every((s) => s.kind === "text")).toBe(true);
  });

  it("the Link field keeps only web and Obsidian links", () => {
    expect(cleanLink(" https://example.com ")).toBe("https://example.com");
    expect(cleanLink("obsidian://open?vault=V")).toBe("obsidian://open?vault=V");
    expect(cleanLink("www.example.com")).toBe("https://www.example.com");
    expect(cleanLink("javascript:alert(1)")).toBeNull();
    expect(cleanLink("two words")).toBeNull();
  });
});

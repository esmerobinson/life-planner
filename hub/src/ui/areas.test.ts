import { AREA_IDS } from "../domain/types";
import { AREA_CHOICES, GOAL_AREAS, NAV } from "./areas";

describe("areas", () => {
  it("AREA_IDS is the one list of ids", () => {
    expect([...AREA_IDS]).toEqual([
      "inbox", "mind", "writing", "art", "content", "body", "tech", "production", "admin",
    ]);
  });

  it("NAV has fourteen entries in order with exact labels and paths", () => {
    expect(NAV.map((n) => [n.label, n.path])).toEqual([
      ["Home", "/"], ["Goals", "/goals"], ["Repeating", "/repeating"], ["Admin", "/area/admin"],
      ["Mind", "/area/mind"], ["Writing", "/area/writing"], ["Art", "/area/art"],
      ["Content", "/area/content"], ["Body", "/area/body"],
      ["Tech projects", "/area/tech"], ["Production", "/area/production"],
      ["Journal", "/journal"], ["Vision board", "/vision"], ["Esme's Rio", "/farm"],
    ]);
  });

  it("every area route in NAV and every form choice is a known area id", () => {
    const ids = AREA_IDS as readonly string[];
    for (const n of NAV.filter((x) => x.path.startsWith("/area/"))) {
      expect(ids).toContain(n.path.replace("/area/", ""));
    }
    for (const a of GOAL_AREAS) expect(ids).toContain(a.id);
    for (const a of AREA_CHOICES) expect(ids).toContain(a.id);
  });

  it("goal areas are every area but the inbox; choices add the inbox first", () => {
    expect(GOAL_AREAS.map((a) => a.id)).toEqual(
      ["mind", "writing", "art", "content", "body", "tech", "production", "admin"],
    );
    expect(AREA_CHOICES[0].id).toBe("inbox");
    expect(AREA_CHOICES).toHaveLength(9);
  });

  it("the new tiles use the specified colours", () => {
    const tile = (id: string) => NAV.find((n) => n.id === id)!.tile;
    expect(tile("tech")).toBe("#cedb6e");
    expect(tile("production")).toBe("#d59770");
    expect(tile("admin")).toBe("#90825b");
  });

  it("Repeating sits right under Goals on Rescue coral with its own repeat-arrows icon (Esme's pick A, 2026-11-17)", () => {
    const ids = NAV.map((n) => n.id);
    expect(ids.indexOf("repeating")).toBe(ids.indexOf("goals") + 1);
    const r = NAV.find((n) => n.id === "repeating")!;
    expect(r).toMatchObject({ label: "Repeating", path: "/repeating", tile: "#df7e6f", group: 1 });
    // Drawn in the area icons' style: 32 viewBox, #3a412f 2.4 stroke, cream fill.
    const svg = decodeURIComponent(r.icon);
    expect(svg).toContain("viewBox='0 0 32 32'");
    expect(svg).toContain("stroke='#3a412f' stroke-width='2.4'");
    expect(svg).toContain("fill='#e9e3d6'");
    expect(NAV.filter((n) => n.icon === r.icon)).toHaveLength(1);
  });

  it("Esme's Rio (was Esme's Farm, renamed 2026-11-16) is the pixel barn on the Room Sketch yellow tile (Esme, 2026-11-04)", () => {
    const farm = NAV.find((n) => n.id === "farm")!;
    expect(farm.icon).toContain("esmes-farm-icon-pixel");
    expect(farm.tile).toBe("#e2cd5b");
  });
});

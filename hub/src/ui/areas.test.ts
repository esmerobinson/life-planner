import { AREA_IDS } from "../domain/types";
import { AREA_CHOICES, GOAL_AREAS, NAV } from "./areas";

describe("areas", () => {
  it("AREA_IDS is the one list of ids", () => {
    expect([...AREA_IDS]).toEqual([
      "inbox", "writing", "art", "content", "mind", "body", "tech", "production", "admin",
    ]);
  });

  it("NAV has thirteen entries in order with exact labels and paths", () => {
    expect(NAV.map((n) => [n.label, n.path])).toEqual([
      ["Home", "/"], ["Today", "/today"], ["Goals", "/goals"], ["Admin", "/area/admin"],
      ["Writing", "/area/writing"], ["Art", "/area/art"], ["Content", "/area/content"],
      ["Mind", "/area/mind"], ["Body", "/area/body"],
      ["Tech projects", "/area/tech"], ["Production", "/area/production"],
      ["Journal", "/journal"], ["Vision board", "/vision"],
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
      ["writing", "art", "content", "mind", "body", "tech", "production", "admin"],
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
});

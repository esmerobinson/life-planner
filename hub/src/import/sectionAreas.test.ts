import { sectionToArea } from "./sectionAreas";

describe("sectionToArea additions for goals", () => {
  it("maps creative technologist to tech and keeps inner work on mind", () => {
    expect(sectionToArea("Creative technologist")).toBe("tech");
    expect(sectionToArea("Inner work (the meta-goal)")).toBe("mind");
    expect(sectionToArea("Inner work")).toBe("mind");
  });
  it("maps parenthetical area names", () => {
    expect(sectionToArea("Production & freelance")).toBe("production");
    expect(sectionToArea("Writing (Relationship Book)")).toBe("writing");
  });
  it("still sends unknown headings to the inbox", () => {
    expect(sectionToArea("Something else")).toBe("inbox");
  });
});

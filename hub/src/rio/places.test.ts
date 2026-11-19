import { RIO_MAP } from "./assets";
import { RIO_PLACE_KEYS } from "./places";

describe("RIO_PLACE_KEYS", () => {
  it("is exactly the map's places, in order (a re-imported map with new places must update it)", () => {
    expect([...RIO_PLACE_KEYS]).toEqual(RIO_MAP.places.map((p) => p.key));
  });
});

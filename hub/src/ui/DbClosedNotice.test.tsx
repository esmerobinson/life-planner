import { render, screen } from "@testing-library/react";
import Dexie from "dexie";
import { HubDB } from "../data/db";
import { DbClosedNotice } from "./DbClosedNotice";

describe("DbClosedNotice", () => {
  it("says to reload when a newer version of the app upgrades the database from another tab", async () => {
    const name = "closed-notice-test";
    const mine = new HubDB(name);
    await mine.open();
    render(<DbClosedNotice db={mine} />);
    expect(screen.queryByRole("alert")).toBeNull();

    const newer = new Dexie(name); // another tab, on a newer build
    newer.version(40).stores({ items: "id", goals: "id" });
    await newer.open();

    expect(await screen.findByRole("alert")).toHaveTextContent("Esmeworld was updated. Reload to keep going.");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    newer.close();
    await Dexie.delete(name);
  });
});

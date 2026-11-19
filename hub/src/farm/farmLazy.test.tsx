import { screen } from "@testing-library/react";
import { renderApp } from "../test/renderApp";

// Esme's Rio is a lazily loaded chunk (App.tsx). Here its file never arrives (offline before it
// was ever stored, or an old page asking for a file a new deploy replaced): the game screen's
// placeholder shows while it is asked for, then the page's problem note, and the rest of the app
// stays. (The reload-once guard on a real failed chunk: native/appUpdate.test.tsx, e2e/pwa.spec.ts.)

let fail: (e: Error) => void = () => undefined;
vi.mock("./FarmPage", async () => {
  await new Promise((_, reject) => {
    fail = reject;
  });
  return {};
});

afterEach(() => vi.useRealTimers());

it("a game chunk that fails to load shows the page's problem note, never a blank app", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  renderApp("/farm", "2026-11-04");
  // While it loads: the placeholder.
  expect(await screen.findByRole("status", { name: "" })).toHaveTextContent("Loading Esme's Rio");
  fail(new Error("Failed to fetch dynamically imported module: /assets/FarmPage-x.js"));
  expect(await screen.findByText("This page hit a problem. Everything you wrote is saved.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  expect(screen.queryByText("Loading Esme's Rio")).not.toBeInTheDocument();
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { PanelProvider, usePanel } from "./panelContext";

function Probe() {
  const panel = usePanel()!;
  const l = useLocation();
  return (
    <>
      <p data-testid="url">{l.pathname + l.search}</p>
      <button type="button" onClick={() => panel.open("x")}>open</button>
      <button
        type="button"
        onClick={() => {
          // Two closes before the URL catches up (Delete goal, then the stale-?open check).
          panel.close();
          panel.close();
        }}
      >
        close twice
      </button>
    </>
  );
}

it("two closes in a row go Back one step, not two", async () => {
  render(
    <MemoryRouter initialEntries={["/before", "/goals"]} initialIndex={1}>
      <PanelProvider>
        <Probe />
      </PanelProvider>
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole("button", { name: "open" }));
  expect(screen.getByTestId("url")).toHaveTextContent("/goals?open=x");
  await userEvent.click(screen.getByRole("button", { name: "close twice" }));
  expect(screen.getByTestId("url")).toHaveTextContent(/^\/goals$/);
  // Opened again later, it still closes.
  await userEvent.click(screen.getByRole("button", { name: "open" }));
  await userEvent.click(screen.getByRole("button", { name: "close twice" }));
  expect(screen.getByTestId("url")).toHaveTextContent(/^\/goals$/);
});

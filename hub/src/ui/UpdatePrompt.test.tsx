import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UpdatePrompt } from "./UpdatePrompt";

function hook(needRefresh: boolean, update = vi.fn()) {
  return () => ({ needRefresh: [needRefresh, vi.fn()] as [boolean, never], updateServiceWorker: update });
}

describe("UpdatePrompt", () => {
  it("is hidden when there is no update", () => {
    render(<UpdatePrompt useRegisterSW={hook(false)} />);
    expect(screen.queryByText("A new version is ready.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("shows the line and Reload button when an update is waiting; Reload updates once", async () => {
    const update = vi.fn();
    render(<UpdatePrompt useRegisterSW={hook(true, update)} />);
    expect(screen.getByText("A new version is ready.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(update).toHaveBeenCalledTimes(1);
  });
});

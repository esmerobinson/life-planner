import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UpdatePrompt, type PromptUpdater } from "./UpdatePrompt";
import type { UpdateState } from "../native/pwaUpdate";

function fake(initial: UpdateState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const updater: PromptUpdater & { set: (s: UpdateState) => void } = {
    getState: () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    reloadNow: vi.fn(async () => {}),
    set: (s) => {
      state = s;
      for (const fn of listeners) fn();
    },
  };
  return updater;
}

describe("UpdatePrompt", () => {
  it("is hidden when there is no update", () => {
    render(<UpdatePrompt updater={fake({ waiting: false, showNote: false })} />);
    expect(screen.queryByText("A new version is ready.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("is hidden while the update is waiting to apply itself", () => {
    render(<UpdatePrompt updater={fake({ waiting: true, showNote: false })} />);
    expect(screen.queryByText("A new version is ready.")).toBeNull();
  });

  it("is hidden outside the app (no updater: tests, no service worker)", () => {
    render(<UpdatePrompt updater={null} />);
    expect(screen.queryByText("A new version is ready.")).toBeNull();
  });

  it("shows the line and Reload once the automatic update keeps being refused; Reload updates once", async () => {
    const u = fake({ waiting: true, showNote: false });
    render(<UpdatePrompt updater={u} />);
    act(() => u.set({ waiting: true, showNote: true }));
    expect(screen.getByText("A new version is ready.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(u.reloadNow).toHaveBeenCalledTimes(1);
  });
});

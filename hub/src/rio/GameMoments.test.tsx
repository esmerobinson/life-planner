import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { GameMoments } from "./GameMoments";

// Esme, 2026-11-17: the nook box is gone from the game screen; an earned sticker's moment is a
// small kit pop-up top centre instead. Fictional stickers.

function Host({ queue, markSeen }: { queue: string[]; markSeen: (k: string) => Promise<void> }) {
  const [q, setQ] = useState(queue);
  return <GameMoments queue={q} markSeen={async (k) => { await markSeen(k); setQ((x) => x.filter((y) => y !== k)); }} />;
}

it("shows the newly earned stickers top centre, keeps them for good, and stays until OK", async () => {
  const markSeen = vi.fn(async () => undefined);
  render(<Host queue={["hi", "seeds-mind"]} markSeen={markSeen} />);
  const pop = await screen.findByRole("status");
  expect(pop).toHaveTextContent("New sticker: Welcome");
  expect(pop).toHaveTextContent("New sticker: Mind: seeds");
  await waitFor(() => expect(markSeen).toHaveBeenCalledTimes(2));
  // Seen for good, still on screen until she says OK.
  expect(screen.getByRole("status")).toHaveTextContent("Welcome");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(screen.queryByRole("status")).toBeNull();
});

it("nothing queued, nothing shown", () => {
  render(<GameMoments queue={[]} markSeen={async () => undefined} />);
  expect(screen.queryByRole("status")).toBeNull();
});

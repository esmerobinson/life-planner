import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { db } from "../data/db";
import { DEFAULT_BOARD, PINS_META_KEY, STALE_MS } from "../vision/board";
import { VisionPage } from "./VisionPage";

// Fictional pins only.
const pin = (n: number) => ({
  img: `https://i.pinimg.com/736x/fi/ct/fictional${n}.jpg`,
  link: `https://www.pinterest.com/pin/fictional-${n}/`,
});
const NOW = 1_790_000_000_000;

beforeEach(async () => {
  await db.syncMeta.clear();
});

async function configure() {
  await db.syncMeta.bulkPut([
    { key: "serverUrl", value: "https://sync.example.test" },
    { key: "token", value: "f".repeat(64) },
  ]);
}

async function cache(board: string, fetchedAt: number, count: number) {
  await db.syncMeta.put({ key: PINS_META_KEY, value: { board, fetchedAt, pins: Array.from({ length: count }, (_, i) => pin(i + 1)) } });
}

function server(answer: (board: string) => { status: number; body?: unknown }) {
  const boards: string[] = [];
  const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
    const board = new URL(String(url)).searchParams.get("board")!;
    boards.push(board);
    const { status, body } = answer(board);
    return new Response(JSON.stringify(body ?? { error: "x" }), { status });
  }) as unknown as typeof fetch;
  return { fetchFn, boards };
}

const ok = (count: number, fetchedAt = NOW) => (board: string) => ({
  status: 200,
  body: { board, fetchedAt, pins: Array.from({ length: count }, (_, i) => pin(i + 1)) },
});

function show(fetchFn: typeof fetch) {
  return render(
    <MemoryRouter>
      <VisionPage fetchFn={fetchFn} now={() => NOW} />
    </MemoryRouter>,
  );
}

const pinLinks = () => screen.queryAllByRole("link", { name: "Open pin on Pinterest" });

describe("VisionPage", () => {
  it("points to Sync when sync is not set up and nothing is stored", async () => {
    const { fetchFn } = server(ok(3));
    show(fetchFn);
    expect(await screen.findByText(/Set up Sync on this device/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sync" })).toHaveAttribute("href", "/sync");
    expect(pinLinks()).toHaveLength(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("shows the stored board when sync is not set up", async () => {
    await cache(DEFAULT_BOARD, NOW - 3 * 60 * 60_000, 4);
    const { fetchFn } = server(ok(3));
    show(fetchFn);
    await waitFor(() => expect(pinLinks()).toHaveLength(4));
    expect(screen.getByText("from Pinterest · visionboardfuture · 4 pins · updated 3 hours ago")).toBeInTheDocument();
    expect(screen.getByText(/Set up Sync on this device/)).toBeInTheDocument();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("shows a fresh stored board straight away without asking again", async () => {
    await configure();
    await cache(DEFAULT_BOARD, NOW - 5 * 60_000, 12);
    const { fetchFn } = server(ok(3));
    show(fetchFn);
    await waitFor(() => expect(pinLinks()).toHaveLength(12));
    expect(screen.getByText("from Pinterest · visionboardfuture · 12 pins · updated 5 min ago")).toBeInTheDocument();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("asks again on open when the stored board is 15 minutes old", async () => {
    await configure();
    await cache(DEFAULT_BOARD, NOW - STALE_MS, 2);
    const { fetchFn, boards } = server(ok(5));
    show(fetchFn);
    await waitFor(() => expect(pinLinks()).toHaveLength(5));
    expect(boards).toEqual([DEFAULT_BOARD]);
    expect(screen.getByText("from Pinterest · visionboardfuture · 5 pins · updated just now")).toBeInTheDocument();
  });

  it("loads the board when nothing is stored, and says 1 pin", async () => {
    await configure();
    const { fetchFn } = server(ok(1));
    show(fetchFn);
    await waitFor(() => expect(pinLinks()).toHaveLength(1));
    expect(screen.getByText("from Pinterest · visionboardfuture · 1 pin · updated just now")).toBeInTheDocument();
  });

  it("renders each pin as a new-tab link around a lazy, no-referrer image with empty alt", async () => {
    await configure();
    const { fetchFn } = server(ok(2));
    const { container } = show(fetchFn);
    await waitFor(() => expect(pinLinks()).toHaveLength(2));
    const link = pinLinks()[0]!;
    expect(link).toHaveAttribute("href", pin(1).link);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    const img = link.querySelector("img")!;
    expect(img).toHaveAttribute("src", pin(1).img);
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(container.querySelector(".vision-collage")).toContainElement(link);
  });

  it("Refresh asks again and shows the new pins", async () => {
    await configure();
    await cache(DEFAULT_BOARD, NOW - 60_000, 2);
    const { fetchFn, boards } = server(ok(6));
    show(fetchFn);
    await waitFor(() => expect(pinLinks()).toHaveLength(2));
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(pinLinks()).toHaveLength(6));
    expect(boards).toEqual([DEFAULT_BOARD]);
  });

  it.each([
    [502, /Pinterest did not answer just now/],
    [429, /asked to wait a little/],
    [401, /passphrase was not accepted/],
    [500, /did not work this time/],
  ])("keeps the stored board and says so calmly on %d", async (status, text) => {
    await configure();
    await cache(DEFAULT_BOARD, NOW - STALE_MS - 1, 3);
    const { fetchFn } = server(() => ({ status }));
    show(fetchFn);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(pinLinks()).toHaveLength(3);
  });

  it("says so when the sync server cannot be reached", async () => {
    await configure();
    const fetchFn = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    show(fetchFn);
    expect(await screen.findByText(/Could not reach the sync server/)).toBeInTheDocument();
  });

  it("says when the board has no pins", async () => {
    await configure();
    const { fetchFn } = server(ok(0));
    show(fetchFn);
    expect(await screen.findByText("This board has no pins yet.")).toBeInTheDocument();
  });

  it("Change board takes a pasted board address, saves it and loads that board", async () => {
    await configure();
    await cache(DEFAULT_BOARD, NOW - 60_000, 2);
    const { fetchFn, boards } = server(ok(4));
    show(fetchFn);
    await waitFor(() => expect(pinLinks()).toHaveLength(2));
    await userEvent.click(screen.getByText("Change board"));
    const field = screen.getByLabelText("Board address");
    expect(field).toHaveValue(DEFAULT_BOARD);
    expect(screen.getByText(/pin\.it/)).toBeInTheDocument(); // the hint about short links
    await userEvent.clear(field);
    await userEvent.type(field, "https://www.pinterest.com/fictionaluser/dreamboard/");
    await userEvent.click(screen.getByRole("button", { name: "Use this board" }));
    await waitFor(() => expect(pinLinks()).toHaveLength(4));
    expect(boards).toEqual(["fictionaluser/dreamboard"]);
    expect((await db.syncMeta.get("visionBoard"))?.value).toBe("fictionaluser/dreamboard");
    expect(screen.getByText("from Pinterest · dreamboard · 4 pins · updated just now")).toBeInTheDocument();
  });

  it("Change board explains pin.it links and refuses what is not a board", async () => {
    await configure();
    await cache(DEFAULT_BOARD, NOW - 60_000, 2);
    const { fetchFn } = server(ok(4));
    show(fetchFn);
    await userEvent.click(await screen.findByText("Change board"));
    const field = screen.getByLabelText("Board address");
    await userEvent.clear(field);
    await userEvent.type(field, "https://pin.it/abc123");
    await userEvent.click(screen.getByRole("button", { name: "Use this board" }));
    expect(await screen.findByText(/Short pin\.it links can't be opened here/)).toBeInTheDocument();
    await userEvent.clear(field);
    await userEvent.type(field, "https://www.pinterest.com/pin/123/");
    await userEvent.click(screen.getByRole("button", { name: "Use this board" }));
    expect(await screen.findByText(/doesn't look like a board address/)).toBeInTheDocument();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await db.syncMeta.get("visionBoard")).toBeUndefined();
  });

  it("does not show a stored list that belongs to a different board", async () => {
    await configure();
    await db.syncMeta.put({ key: "visionBoard", value: "fictionaluser/dreamboard" });
    await cache(DEFAULT_BOARD, NOW - 60_000, 2);
    const { fetchFn, boards } = server(ok(7));
    show(fetchFn);
    await waitFor(() => expect(pinLinks()).toHaveLength(7));
    expect(boards).toEqual(["fictionaluser/dreamboard"]);
  });

  it("shows the heading", async () => {
    show(server(ok(0)).fetchFn);
    expect(screen.getByRole("heading", { level: 1, name: "Vision board" })).toBeInTheDocument();
    await screen.findByText(/Set up Sync on this device/);
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });
});

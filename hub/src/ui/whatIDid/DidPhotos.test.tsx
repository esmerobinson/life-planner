import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import type { FileRow, Item } from "../../domain/types";
import { FILES_HANDLER } from "../../native/files";
import { renderApp } from "../../test/renderApp";

// Photos on "What I did" notes (Esme, 19 Nov 2026): Add photo in the card after a tick and in the
// side panel, thumbnails there and on the log page, tap one to see it larger, Remove photo. On the
// Mac the photo is also copied into the area's folder. Made-up to-dos and image bytes only.

vi.mock("../picture", async (importOriginal) => {
  const real = await importOriginal<typeof import("../picture")>();
  return {
    ...real,
    downscalePicture: async () => ({ mime: "image/jpeg" as const, data: "/9j/4AAQ", width: 1600, height: 1200 }),
  };
});

const TODAY = "2026-11-18";
const todo = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: `Pretend ${id}`, links: [], areaId: "art", priority: 2, status: "done",
  completedAt: "2026-11-17", createdAt: "2026-11-01", touchedAt: "2026-11-01", ...extra,
});
const file = (id: string): FileRow => ({ id, mime: "image/jpeg", data: "/9j/4AAQ", width: 40, height: 30, createdAt: TODAY });
const jpg = () => new File(["pretend bytes"], "IMG_0001.jpg", { type: "image/jpeg" });

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.goals.clear(), db.files.clear(), db.syncMeta.clear()]);
  localStorage.clear();
  delete (window as unknown as { webkit?: unknown }).webkit;
});
afterEach(() => vi.useRealTimers());

const section = () => screen.findByRole("region", { name: "What I did" });

it("the side panel: Add photo stores it on the note and shows it; tapped, it shows larger; Remove photo takes it off", async () => {
  await db.items.put(todo("mural"));
  renderApp("/area/art?open=mural", TODAY);
  const s = await section();
  const input = within(s).getByLabelText("Choose a photo");
  expect(input).toHaveAttribute("accept", "image/*");
  expect(input).not.toHaveAttribute("capture");
  expect(within(s).getByRole("button", { name: "Add photo" })).toBeVisible();
  await userEvent.upload(input as HTMLInputElement, jpg());
  await waitFor(async () => expect((await db.items.get("mural"))!.didPhotos?.[0]?.ids).toHaveLength(1));
  const it = (await db.items.get("mural"))!;
  expect(it.did).toEqual([{ id: "note", on: "2026-11-17" }]);
  const id = it.didPhotos![0]!.ids[0]!;
  expect(await db.files.get(id)).toMatchObject({ mime: "image/jpeg", data: "/9j/4AAQ" });

  const thumb = await within(s).findByRole("button", { name: "Photo 1: show it larger" });
  await userEvent.click(thumb);
  const viewer = await screen.findByRole("dialog", { name: "Photo" });
  expect(within(viewer).getByRole("img")).toHaveAttribute("src", "data:image/jpeg;base64,/9j/4AAQ");
  // Escape closes the photo, not the side panel.
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Photo" })).toBeNull());
  expect(screen.getByRole("region", { name: "What I did" })).toBeInTheDocument();

  await userEvent.click(within(s).getByRole("button", { name: "Remove photo 1" }));
  await waitFor(async () => expect((await db.items.get("mural"))!.didPhotos).toBeUndefined());
});

it("on the Mac the photo is also copied into the area's folder, as a kept file", async () => {
  const sent: Record<string, unknown>[] = [];
  (window as unknown as { webkit: unknown }).webkit = {
    messageHandlers: {
      [FILES_HANDLER]: {
        postMessage: async (m: Record<string, unknown>) => {
          sent.push(m);
          if (m.action === "getRoot") return { root: "~/Desktop" };
          if (m.action === "savePhoto") return { saved: [{ name: m.name, folder: "~/Desktop/Art" }], failed: [] };
          return { cancelled: true };
        },
      },
    },
  };
  await db.items.put(todo("mural"));
  renderApp("/area/art?open=mural", TODAY);
  const s = await section();
  await userEvent.upload(within(s).getByLabelText("Choose a photo") as HTMLInputElement, jpg());
  await waitFor(async () => expect((await db.items.get("mural"))!.did?.[0]?.files).toEqual([{ name: "IMG_0001.jpg", folder: "~/Desktop/Art" }]));
  const save = sent.find((m) => m.action === "savePhoto")!;
  expect(save).toMatchObject({ root: "~/Desktop", parts: ["Art"], name: "IMG_0001.jpg" });
  expect(atob(save.data as string)).toBe("pretend bytes");
  expect((await db.items.get("mural"))!.didPhotos?.[0]?.ids).toHaveLength(1);
});

it("the card after a tick has Add photo too", async () => {
  await db.items.put(todo("sketch", { status: "open", completedAt: undefined }));
  renderApp("/area/art", TODAY);
  await userEvent.click(await screen.findByRole("checkbox", { name: "Mark done: Pretend sketch" }));
  const sheet = await screen.findByRole("dialog", { name: "What did you do?" });
  expect(within(sheet).getByRole("button", { name: "Add photo" })).toBeInTheDocument();
  await userEvent.upload(within(sheet).getByLabelText("Choose a photo") as HTMLInputElement, jpg());
  await waitFor(async () => expect((await db.items.get("sketch"))!.didPhotos?.[0]?.ids).toHaveLength(1));
  expect(await within(sheet).findByRole("img", { name: "Photo 1" })).toBeInTheDocument();
});

it("the log page shows each note's photos; tapped, one shows larger", async () => {
  await db.files.bulkAdd([file("p1"), file("p2")]);
  await db.items.put(todo("mural", { did: [{ id: "note", on: "2026-11-17", note: "Pretend painted" }], didPhotos: [{ entry: "note", ids: ["p1", "p2"] }] }));
  renderApp("/what-i-did", TODAY);
  const entry = (await screen.findByText("Pretend painted")).closest("li")!;
  const thumbs = await within(entry).findAllByRole("button", { name: /show it larger/ });
  expect(thumbs).toHaveLength(2);
  expect(within(entry).queryByRole("button", { name: /Remove photo/ })).toBeNull();
  await userEvent.click(thumbs[1]!);
  const viewer = await screen.findByRole("dialog", { name: "Photo" });
  await userEvent.click(within(viewer).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog", { name: "Photo" })).toBeNull();
});

it("a note keeps up to 20 photos: past that she is told plainly, and nothing extra is stored (review M1)", async () => {
  const nineteen = Array.from({ length: 19 }, (_, i) => `old${i}`);
  await db.items.put(todo("mural", { did: [{ id: "note", on: "2026-11-17" }], didPhotos: [{ entry: "note", ids: nineteen }] }));
  renderApp("/area/art?open=mural", TODAY);
  const s = await section();
  await userEvent.upload(within(s).getByLabelText("Choose a photo") as HTMLInputElement, [jpg(), jpg()]);
  expect(await within(s).findByRole("status")).toHaveTextContent("A note keeps up to 20 photos, so 1 wasn't added.");
  await waitFor(async () => expect((await db.items.get("mural"))!.didPhotos![0]!.ids).toHaveLength(20));
  expect(await db.files.count()).toBe(1);
  await userEvent.upload(within(s).getByLabelText("Choose a photo") as HTMLInputElement, jpg());
  expect(await within(s).findByText("A note keeps up to 20 photos, so 1 wasn't added.")).toBeInTheDocument();
  expect(await db.files.count()).toBe(1);
});

it("the larger photo keeps the focus inside it (review M7)", async () => {
  await db.files.add(file("p1"));
  await db.items.put(todo("mural", { did: [{ id: "note", on: "2026-11-17" }], didPhotos: [{ entry: "note", ids: ["p1"] }] }));
  renderApp("/area/art?open=mural", TODAY);
  await userEvent.click(await within(await section()).findByRole("button", { name: "Photo 1: show it larger" }));
  const close = within(await screen.findByRole("dialog", { name: "Photo" })).getByRole("button", { name: "Close" });
  await waitFor(() => expect(close).toHaveFocus());
  await userEvent.tab();
  expect(close).toHaveFocus();
  await userEvent.tab({ shift: true });
  expect(close).toHaveFocus();
});

it("an older Mac app (no savePhoto yet): the photo is added and nothing complains (review M8)", async () => {
  (window as unknown as { webkit: unknown }).webkit = {
    messageHandlers: {
      [FILES_HANDLER]: {
        postMessage: async (m: Record<string, unknown>) => {
          if (m.action === "getRoot") return { root: "~/Desktop" };
          if (m.action === "savePhoto") throw new Error("unknown action");
          return { cancelled: true };
        },
      },
    },
  };
  await db.items.put(todo("mural"));
  renderApp("/area/art?open=mural", TODAY);
  const s = await section();
  await userEvent.upload(within(s).getByLabelText("Choose a photo") as HTMLInputElement, jpg());
  await waitFor(async () => expect((await db.items.get("mural"))!.didPhotos?.[0]?.ids).toHaveLength(1));
  await within(s).findByRole("button", { name: "Add photo" }); // finished
  expect(within(s).queryByRole("status")).toBeNull();
});

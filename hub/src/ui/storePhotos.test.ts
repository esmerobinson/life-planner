import { vi } from "vitest";
import { db } from "../data/db";
import { PICTURE_HEIC, PICTURE_UNREADABLE } from "./picture";
import { imageFiles, PHOTO_NOT_SAVED, storePhotos } from "./storePhotos";

// Photos chosen, pasted or dropped go through the one picture pipeline (downscale to JPEG, the
// synced files table). The canvas part runs in the browser (e2e); here it is pretended.

const shrink = vi.hoisted(() => ({ fail: new Set<string>() }));
vi.mock("./picture", async (importOriginal) => {
  const real = await importOriginal<typeof import("./picture")>();
  return {
    ...real,
    downscalePicture: async (f: File) => {
      if (shrink.fail.has(f.name)) throw new Error("no");
      return { mime: "image/jpeg" as const, data: "/9j/4AAQ", width: 1600, height: 1200 };
    },
  };
});

const DAY = "2026-11-19";
const jpg = (name: string) => new File(["x"], name, { type: "image/jpeg" });

beforeEach(async () => {
  shrink.fail.clear();
  await db.files.clear();
});

it("stores each photo, in order, and returns their ids", async () => {
  const r = await storePhotos([jpg("a.jpg"), jpg("b.jpg")], DAY);
  expect(r.ids).toHaveLength(2);
  expect(r.message).toBeNull();
  for (const id of r.ids) expect(await db.files.get(id)).toMatchObject({ mime: "image/jpeg", createdAt: DAY });
});

it("an unreadable photo is skipped with a kind word; an iPhone HEIC one says why", async () => {
  shrink.fail.add("bad.jpg");
  let r = await storePhotos([jpg("ok.jpg"), jpg("bad.jpg")], DAY);
  expect(r.ids).toHaveLength(1);
  expect(r.message).toBe(PICTURE_UNREADABLE);
  shrink.fail.add("IMG_0001.HEIC");
  r = await storePhotos([new File(["x"], "IMG_0001.HEIC", { type: "" })], DAY);
  expect(r).toEqual({ ids: [], message: PICTURE_HEIC });
});

it("a photo that cannot be stored says so", async () => {
  vi.spyOn(db.files, "add").mockRejectedValueOnce(new Error("full"));
  const r = await storePhotos([jpg("a.jpg")], DAY);
  expect(r).toEqual({ ids: [], message: PHOTO_NOT_SAVED });
  vi.restoreAllMocks();
});

it("imageFiles: photos only (HEIC with no type too), never other files", () => {
  const list = [jpg("a.jpg"), new File(["x"], "b.heic", { type: "" }), new File(["x"], "c.pdf", { type: "application/pdf" })];
  expect(imageFiles(list).map((f) => f.name)).toEqual(["a.jpg", "b.heic"]);
});

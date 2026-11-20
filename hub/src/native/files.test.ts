import { db } from "../data/db";
import { attachFiles, chooseFilesRoot, FILES_HANDLER, hasFileBridge, loadFilesRoot, resetFilesRoot, revealFile, savePhotoCopy } from "./files";

// The Mac app's file bridge for "What I did" (mac/Esmeworld/main.swift, esmeworldFiles). In a
// browser or on the iPhone there is no bridge and nothing here does anything.

type W = { webkit?: unknown };
const sent: unknown[] = [];
function pretendMac(reply: (m: Record<string, unknown>) => unknown) {
  (window as unknown as W).webkit = {
    messageHandlers: {
      [FILES_HANDLER]: {
        postMessage: async (m: Record<string, unknown>) => {
          sent.push(m);
          const r = reply(m);
          if (r instanceof Error) throw r;
          return r;
        },
      },
    },
  };
}

beforeEach(async () => {
  sent.length = 0;
  delete (window as unknown as W).webkit;
  await db.syncMeta.clear();
});

it("without the Mac app: no bridge, nothing sent", async () => {
  expect(hasFileBridge()).toBe(false);
  expect(await attachFiles({ root: "~/Desktop", area: "Writing" })).toEqual({ kind: "unavailable" });
  expect(await chooseFilesRoot()).toBeNull();
  expect(await revealFile({ name: "a.txt", folder: "~/Desktop/Writing" })).toBe("unavailable");
});

it("Attach files: sends the root and the safe folder names; reads back the saved names", async () => {
  pretendMac(() => ({ saved: [{ name: "plan (2).pdf", folder: "~/Desktop/Tech projects/App- v2" }], failed: [] }));
  const r = await attachFiles({ root: "~/Desktop", area: "Tech projects", project: "App: v2" });
  expect(sent).toEqual([{ action: "attach", root: "~/Desktop", parts: ["Tech projects", "App- v2"] }]);
  expect(r).toEqual({ kind: "saved", files: [{ name: "plan (2).pdf", folder: "~/Desktop/Tech projects/App- v2" }], failed: 0 });
});

it("cancelled, refused by macOS, failed, or a garbled answer", async () => {
  pretendMac(() => ({ cancelled: true }));
  expect(await attachFiles({ root: "~/Desktop", area: "Art" })).toEqual({ kind: "cancelled" });
  pretendMac(() => ({ error: "permission" }));
  expect(await attachFiles({ root: "~/Desktop", area: "Art" })).toEqual({ kind: "permission" });
  pretendMac(() => new Error("boom"));
  expect(await attachFiles({ root: "~/Desktop", area: "Art" })).toEqual({ kind: "error" });
  pretendMac(() => ({ saved: [{ name: 3 }], failed: [{ name: "x" }] }));
  expect(await attachFiles({ root: "~/Desktop", area: "Art" })).toEqual({ kind: "saved", files: [], failed: 2 });
});

it("choose a folder and reveal a file", async () => {
  pretendMac((m) => (m.action === "chooseRoot" ? { root: "~/Documents/Work" } : { ok: m.name === "here.txt", missing: m.name !== "here.txt" }));
  expect(await chooseFilesRoot()).toBe("~/Documents/Work");
  expect(await revealFile({ name: "here.txt", folder: "~/Desktop/Art" })).toBe("ok");
  expect(await revealFile({ name: "gone.txt", folder: "~/Desktop/Art" })).toBe("missing");
  expect(sent[1]).toEqual({ action: "reveal", folder: "~/Desktop/Art", name: "here.txt" });
});

it("the folder is the Mac app's own (review M1): read from it, chosen through its picker, reset to the Desktop", async () => {
  expect(await loadFilesRoot()).toBe("~/Desktop"); // no bridge: the default
  let root = "~/Desktop";
  pretendMac((m) => {
    if (m.action === "chooseRoot") root = "~/Documents/Work";
    if (m.action === "resetRoot") root = "~/Desktop";
    return { root };
  });
  expect(await loadFilesRoot()).toBe("~/Desktop");
  expect(await chooseFilesRoot()).toBe("~/Documents/Work");
  expect(await loadFilesRoot()).toBe("~/Documents/Work");
  expect(await resetFilesRoot()).toBe("~/Desktop");
  expect(sent.map((m) => (m as { action: string }).action)).toEqual(["getRoot", "chooseRoot", "getRoot", "resetRoot"]);
  expect(await db.syncMeta.count()).toBe(0); // nothing kept by the page
});

it("a photo added on the Mac: its bytes are copied into the area's folder under a safe name", async () => {
  expect(await savePhotoCopy({ root: "~/Desktop", area: "Art", name: "IMG_0001.HEIC", data: "AAAA" })).toEqual({ kind: "unavailable" });
  pretendMac(() => ({ saved: [{ name: "IMG_0001 (2).HEIC", folder: "~/Desktop/Art/Mural- v2" }], failed: [] }));
  const r = await savePhotoCopy({ root: "~/Desktop", area: "Art", project: "Mural: v2", name: "IMG_0001.HEIC", data: "AAAA" });
  expect(sent).toEqual([{ action: "savePhoto", root: "~/Desktop", parts: ["Art", "Mural- v2"], name: "IMG_0001.HEIC", data: "AAAA" }]);
  expect(r).toEqual({ kind: "saved", files: [{ name: "IMG_0001 (2).HEIC", folder: "~/Desktop/Art/Mural- v2" }], failed: 0 });
  sent.length = 0;
  pretendMac(() => ({ error: "permission" }));
  expect(await savePhotoCopy({ root: "~/Desktop", area: "Art", name: "a/b:.png", data: "AAAA" })).toEqual({ kind: "permission" });
  expect((sent[0] as { name: string }).name).toBe("a-b-.png");
  // An older Mac app (no savePhoto yet) answers "unknown action": like no bridge (review M8).
  pretendMac(() => new Error("unknown action"));
  expect(await savePhotoCopy({ root: "~/Desktop", area: "Art", name: "", data: "AAAA" })).toEqual({ kind: "unavailable" });
  expect((sent[sent.length - 1] as { name: string }).name).toBe("Photo.jpg");
});

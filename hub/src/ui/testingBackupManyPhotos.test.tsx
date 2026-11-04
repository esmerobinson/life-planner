// Testing session (backup area), bug: once the hub holds a lot of pictures (e.g. a morning-pages
// photo most days for a couple of years), "Download backup" stops working for good.
// What Esme would see: she presses Download backup and gets "The backup could not be made. Try
// again." every time, so she has no backup at all. Cause: BackupPage builds the whole backup as
// ONE string (JSON.stringify(file, null, 2)); Chrome/V8 cannot make a string longer than about
// 536 million characters, and pictures are stored as base64 text of up to ~933,000 characters
// each, so ~800 photos is enough. (Restore has the same ceiling: `file.text()` of such a file.)
//
// To keep the test light the picture rows are the SAME object repeated (no 500 MB in
// fake-indexeddb): db.files.toArray is stubbed to return 820 fictional ~650 KB photo rows.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import type { FileRow } from "../domain/types";
import { BackupPage } from "./BackupPage";

afterEach(() => vi.restoreAllMocks());

describe("Download backup with many pictures", () => {
  it("makes a backup file when the hub holds 820 photos of about 500 KB each", async () => {
    const photo: FileRow = {
      id: "pretend-photo", mime: "image/jpeg", data: "A".repeat(666_668), width: 1600, height: 1200,
      createdAt: "2026-10-01", encrypted: true, iv: "AAAAAAAAAAAAAAAA", fp: "0123456789abcdef",
    };
    vi.spyOn(db.files, "toArray").mockResolvedValue(Array.from({ length: 820 }, () => photo) as never);
    // jsdom has no object URLs; a real browser does.
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:pretend"), revokeObjectURL: vi.fn() });
    const user = userEvent.setup();
    render(<BackupPage today="2026-10-28" />);
    await user.click(screen.getAllByRole("button", { name: "Download backup" })[0]!);
    await waitFor(() => expect(screen.queryByRole("status") ?? screen.queryByRole("alert")).not.toBeNull(), { timeout: 30_000 });
    expect(screen.queryByRole("alert")?.textContent ?? "").toBe("");
    expect(screen.getByRole("status")).toHaveTextContent("Backup file made.");
  }, 60_000);
});

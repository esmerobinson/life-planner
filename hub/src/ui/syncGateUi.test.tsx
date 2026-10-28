import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "../data/db";
import { REPLACE_OFF_WHILE_SYNCING, WAITING_FIRST_SYNC } from "../data/syncGate";
import { syncController } from "../sync";
import { BackupPage } from "./BackupPage";
import { ImportPanel } from "./ImportPanel";

const TOKEN = "cafe".padEnd(64, "0"); // fake

beforeEach(async () => {
  await db.items.clear();
  await db.syncMeta.clear();
});
afterEach(async () => {
  await db.syncMeta.clear();
  await act(() => syncController.reload());
});

async function syncOn(firstPullDone: boolean) {
  await db.syncMeta.bulkPut([
    { key: "serverUrl", value: "https://sync.example.test" },
    { key: "token", value: TOKEN },
    ...(firstPullDone ? [{ key: "firstPullDone", value: true }] : []),
  ]);
}

describe("Backup page while sync is on", () => {
  it("before the first sync finishes: Merge is off and says why; Replace is off and says why", async () => {
    await syncOn(false);
    render(<BackupPage today="2026-10-28" />);
    expect((await screen.findAllByText(WAITING_FIRST_SYNC)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
    expect(screen.getByText(REPLACE_OFF_WHILE_SYNCING)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Replace everything" })).toBeDisabled();
  });

  it("after the first sync: Merge works, Replace stays off", async () => {
    const user = userEvent.setup();
    await syncOn(true);
    render(<BackupPage today="2026-10-28" />);
    expect(await screen.findByText(REPLACE_OFF_WHILE_SYNCING)).toBeInTheDocument();
    expect(screen.queryByText(WAITING_FIRST_SYNC)).toBeNull();
    const file = new File([JSON.stringify({ app: "life-hub", schema: 1, exportedOn: "2026-10-28", items: [
      { id: "n", kind: "task", title: "From file", links: [], areaId: "art", priority: 2, status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01" },
    ], goals: [] })], "b.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("Backup file"), file);
    await user.click(screen.getByRole("button", { name: "Merge" }));
    expect(await screen.findByText(/Added 1 task/)).toBeInTheDocument();
  });

  it("with sync off, nothing is disabled", async () => {
    render(<BackupPage today="2026-10-28" />);
    await act(() => syncController.reload());
    expect(screen.getByRole("radio", { name: "Replace everything" })).toBeEnabled();
    expect(screen.queryByText(REPLACE_OFF_WHILE_SYNCING)).toBeNull();
  });
});

describe("Import panel while sync is on", () => {
  it("before the first sync finishes the import buttons are off and say why", async () => {
    await syncOn(false);
    render(<ImportPanel today="2026-10-28" />);
    await act(() => syncController.reload());
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import Google Tasks" })).toBeDisabled();
    expect(screen.getAllByText(WAITING_FIRST_SYNC).length).toBeGreaterThanOrEqual(1);
  });
});

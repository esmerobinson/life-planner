import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

async function expectCalm(page: Page, text: string) {
  await expect(page.getByText(text).first()).toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/NaN|undefined|error/i);
}

test("first run, import, file, tick, move, persist and backup round trip", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await test.step("first run: calm empty states", async () => {
    // Calm empty states.
    await expectCalm(page, "Nothing planned for today.");
    await page.goto("/today");
    await expectCalm(page, "Nothing planned for today.");
    await page.goto("/goals");
    await expectCalm(page, "No goals yet.");
    await page.goto("/inbox");
    await expectCalm(page, "Nothing waiting in the inbox.");
  });

  await test.step("import backlog twice", async () => {
    // Import a fictional backlog (one Writing item, one overdue).
    const overdue = await pageDate(page, -3);
    const backlog = [
      "## Writing",
      "- [ ] Draft the fictional zine intro",
      "## Active",
      "- [ ] Alpha pretend errand",
      "- [ ] Beta pretend errand",
      "- [ ] Gamma pretend errand",
      `- [ ] Overdue pretend errand [due ${overdue}]`,
    ].join("\n");
    await page.goto("/backup");
    await page.getByText("Import from a file", { exact: true }).click();
    await page.getByLabel("Backlog text").fill(backlog);
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText("Added 5, already had 0")).toBeVisible();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText("Added 0, already had 5")).toBeVisible();

    // Writing item filed by its heading.
    await page.goto("/area/writing");
    await expect(page.getByText("Draft the fictional zine intro")).toBeVisible();
  });

  await test.step("triage: bulk move and File it", async () => {
    // Bulk move two Inbox items to Art.
    await page.goto("/inbox");
    await expect(page.getByLabel("Inbox items").getByRole("listitem")).toHaveCount(4);
    await page.getByLabel("Select Alpha pretend errand").check();
    await page.getByLabel("Select Beta pretend errand").check();
    await page.getByLabel("Move selected to").selectOption({ label: "Art" });
    await page.getByRole("button", { name: "Move selected" }).click();
    await expect(page.getByLabel("Inbox items").getByRole("listitem")).toHaveCount(2);
    await page.goto("/area/art");
    await expect(page.getByText("Alpha pretend errand")).toBeVisible();
    await expect(page.getByText("Beta pretend errand")).toBeVisible();

    // File one item with the per-row More options and File it.
    await page.goto("/inbox");
    const row = page.getByLabel("Inbox items").getByRole("listitem").filter({ hasText: "Overdue pretend errand" });
    await row.getByText("More options", { exact: true }).click();
    await row.getByLabel("Area for Overdue pretend errand").selectOption({ label: "Admin" });
    await row.getByRole("button", { name: "File Overdue pretend errand", exact: true }).click();
    await expect(page.getByLabel("Inbox items").getByRole("listitem")).toHaveCount(1);
  });

  await test.step("tick, Done and Undo", async () => {
    // Today shows the overdue pick; tick it.
    await page.goto("/today");
    const row = page.getByRole("listitem").filter({ hasText: "Overdue pretend errand" });
    await expect(row).toBeVisible();
    await expect(row.getByText(/· 3 days late$/)).toBeVisible();
    await expect(row.getByText("OVERDUE", { exact: true })).toHaveCount(0);
    await row.getByRole("checkbox", { name: "Mark done: Overdue pretend errand" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Overdue pretend errand" })).toHaveCount(0);

    // It sits under Done (1) on its area page, ticked; unticking brings it back.
    await page.goto("/area/admin");
    await expect(page.getByText("1 ticked off in", { exact: false })).toBeVisible();
    await page.getByText("Done (1)", { exact: true }).click();
    const ticked = page.getByRole("list", { name: "Done" }).getByRole("checkbox", { name: "Mark done: Overdue pretend errand" });
    await expect(ticked).toBeChecked();
    await ticked.click();
    await expect(page.getByText("Done (0)", { exact: true })).toBeVisible();
    await page.goto("/today");
    await expect(page.getByRole("listitem").filter({ hasText: "Overdue pretend errand" })).toBeVisible();
  });

  await test.step("move to Tomorrow", async () => {
    // Schedule it for Tomorrow: it leaves Today.
    await page.getByRole("button", { name: "Schedule for: Overdue pretend errand" }).click();
    await page.getByRole("button", { name: "Tomorrow", exact: true }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Overdue pretend errand" })).toHaveCount(0);
  });

  await test.step("reload persistence", async () => {
    // Reload: persisted.
    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: "Overdue pretend errand" })).toHaveCount(0);
    await page.goto("/area/art");
    await expect(page.getByText("Alpha pretend errand")).toBeVisible();
    await page.goto("/inbox");
    await expect(page.getByText("Gamma pretend errand")).toBeVisible();
  });

  await test.step("tomorrow clock", async () => {
    // When the clock reads tomorrow, the pinned item is back on Today.
    const tomorrow = await pageDate(page, 1);
    await page.clock.setFixedTime(new Date(`${tomorrow}T12:00:00`));
    await page.goto("/today");
    await expect(page.getByRole("listitem").filter({ hasText: "Overdue pretend errand" })).toBeVisible();
    // The remaining steps deliberately run on the fake "tomorrow" clock.
  });

  await test.step("backup round trip", async () => {
    // Backup, wipe, restore with Replace.
    await page.goto("/backup");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download backup" }).click();
    const download = await downloadPromise;
    const file = testInfo.outputPath("backup.json");
    await download.saveAs(file);

    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      await Promise.all(
        dbs.map(
          (d) =>
            new Promise<void>((res, rej) => {
              const r = indexedDB.deleteDatabase(d.name!);
              r.onsuccess = () => res();
              r.onerror = () => rej(r.error);
              r.onblocked = () => res();
            }),
        ),
      );
    });
    await page.goto("/inbox");
    await page.reload();
    await expectCalm(page, "Nothing waiting in the inbox.");

    await page.goto("/backup");
    await page.getByLabel("Backup file").setInputFiles(file);
    await page.getByLabel("Replace everything").check();
    await page.getByLabel("I understand replace removes what is here now").check();
    await page.getByRole("button", { name: "Replace", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Added 5 tasks");

    await page.goto("/area/writing");
    await expect(page.getByText("Draft the fictional zine intro")).toBeVisible();
    await page.goto("/area/art");
    await expect(page.getByText("Alpha pretend errand")).toBeVisible();
    await expect(page.getByText("Beta pretend errand")).toBeVisible();
    await page.goto("/inbox");
    await expect(page.getByText("Gamma pretend errand")).toBeVisible();
    await page.goto("/area/admin");
    await expect(page.getByText("Overdue pretend errand")).toBeVisible();
  });
});

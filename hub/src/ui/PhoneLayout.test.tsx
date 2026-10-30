import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../data/db";
import { createItem } from "../data/repo";
import { todayISO } from "../domain/dates";
import { AppShell } from "./AppShell";
import { HomePage } from "./HomePage";
import { phoneTitle } from "./PhoneTopBar";
import { useShellToday } from "./shellContext";
import { TodayPanel } from "./TodayPanel";

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function HomeRoute() {
  return (
    <>
      <HomePage today={useShellToday()} />
      <p data-testid="nav-type">{useNavigationType()}</p>
    </>
  );
}

function JournalSpy() {
  const l = useLocation();
  return <h1>{`Journal at ${l.pathname}${l.hash}`}</h1>;
}

function TodayRoute() {
  return <TodayPanel today={useShellToday()} />;
}

function renderAt(entries: string[], index = entries.length - 1) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/today" element={<TodayRoute />} />
          <Route path="/goals" element={<h1>Goals</h1>} />
          <Route path="/area/art" element={<h1>Art</h1>} />
          <Route path="/goals/:id" element={<h1>A goal opened</h1>} />
          <Route path="/journal" element={<JournalSpy />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("phone layout (below 700px)", () => {
  beforeEach(() => setPhone(true));

  it("Home: Esmeworld title, Inbox pill, the 12 apps in sidebar order, Today, then the footer links; no sidebar", async () => {
    await createItem({ kind: "task", title: "Phone pick", areaId: "body", priority: 3, due: todayISO() }, todayISO());
    renderAt(["/"]);
    expect(await screen.findByText("Phone pick")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Esmeworld" })).toBeInTheDocument();
    expect(document.querySelector("aside.sidebar")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    const apps = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
    expect(apps.map((a) => a.textContent)).toEqual([
      "Today", "Goals", "Admin", "Writing", "Art", "Content", "Mind", "Body",
      "Tech projects", "Production", "Journal", "Vision board",
    ]);
    expect(apps[4]).toHaveAttribute("href", "/area/art");
    expect(screen.getByRole("heading", { level: 2, name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inbox (1)" })).toHaveAttribute("href", "/inbox");
    const footer = screen.getByRole("navigation", { name: "More" });
    expect(within(footer).getAllByRole("link").map((a) => a.textContent)).toEqual(["Backup", "Sync", "Bin"]);
    // Desktop-only parts of Home stay off the phone Home.
    expect(screen.queryByText("Goals this month")).toBeNull();
  });

  it("another page: round Back arrow, the title in the bar, the Inbox pill; the page h1 stays for screen readers", async () => {
    renderAt(["/today"]);
    await screen.findByText("Nothing planned for today.");
    const bar = document.querySelector(".phone-top")!;
    expect(within(bar as HTMLElement).getByRole("button", { name: "Back" })).toHaveTextContent("←");
    expect(bar).toHaveTextContent("Today");
    expect(within(bar as HTMLElement).getByRole("link", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1, name: "Today" })).toHaveLength(1);
    expect(document.querySelector(".app-content")).toHaveClass("has-bar-title");
  });

  it("Back goes to the previous page in history", async () => {
    renderAt(["/goals", "/area/art"]);
    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Goals" })).toBeInTheDocument();
  });

  it("Back goes Home when the app was opened on this page", async () => {
    renderAt(["/area/art"]);
    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Esmeworld" })).toBeInTheDocument();
    // A replace, so the system swipe-back does not return to the page just left.
    expect(screen.getByTestId("nav-type")).toHaveTextContent("REPLACE");
  });

  it("Home shows the Journal card under the app grid and above Today", async () => {
    renderAt(["/"]);
    await screen.findByText("Nothing planned for today.");
    const grid = screen.getByRole("navigation", { name: "Main" });
    const journal = screen.getByRole("region", { name: "Journal" });
    const today = screen.getByRole("heading", { level: 2, name: "Today" });
    expect(within(journal).getByRole("button", { name: "Morning pages" })).toBeEnabled();
    expect(within(journal).getByRole("button", { name: "Daily check-in" })).toBeEnabled();
    const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(grid, journal)).toBe(true);
    expect(follows(journal, today)).toBe(true);
  });

  it("the phone Home card's buttons open the Journal's two parts", async () => {
    setPhone(true);
    const first = renderAt(["/"]);
    await userEvent.click(await screen.findByRole("button", { name: "Morning pages" }));
    expect(await screen.findByRole("heading", { name: "Journal at /journal#morning-pages" })).toBeInTheDocument();
    first.unmount();
    renderAt(["/"]);
    await userEvent.click(await screen.findByRole("button", { name: "Daily check-in" }));
    expect(await screen.findByRole("heading", { name: "Journal at /journal#daily-check-in" })).toBeInTheDocument();
  });

  it("an opened goal keeps its own heading visible and the bar title empty", async () => {
    renderAt(["/goals", "/goals/g1"]);
    expect(await screen.findByRole("heading", { name: "A goal opened" })).toBeInTheDocument();
    expect(document.querySelector(".phone-title")).toHaveTextContent(/^$/);
    expect(document.querySelector(".app-content")).not.toHaveClass("has-bar-title");
  });
});

describe("desktop layout (700px and wider) is unchanged", () => {
  beforeEach(() => setPhone(false));

  it("keeps the sidebar, the Add/Inbox row and the desktop Home", async () => {
    renderAt(["/"]);
    expect(await screen.findByText("Goals this month")).toBeInTheDocument();
    expect(document.querySelector("aside.sidebar")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(document.querySelector(".phone-top")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inbox" })).toBeInTheDocument();
  });
});

describe("phoneTitle", () => {
  it("names the sidebar pages and footer pages, and nothing for an opened goal or unknown page", () => {
    expect(phoneTitle("/today")).toBe("Today");
    expect(phoneTitle("/area/tech")).toBe("Tech projects");
    expect(phoneTitle("/vision")).toBe("Vision board");
    expect(phoneTitle("/inbox/")).toBe("Inbox");
    expect(phoneTitle("/backup")).toBe("Backup");
    expect(phoneTitle("/sync")).toBe("Sync");
    expect(phoneTitle("/bin")).toBe("Bin");
    expect(phoneTitle("/goals/abc")).toBeNull();
    expect(phoneTitle("/inbox/sort")).toBeNull();
  });
});

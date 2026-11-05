import { render, screen } from "@testing-library/react";
import { Streak } from "./Streak";

// The one streak (VISUAL-LANGUAGE.md "Streak (2026-11-02)", mockup-streaks.html option D):
// seven bars for the last seven days ending today, then the number.

const week = (...on: number[]) => [0, 1, 2, 3, 4, 5, 6].map((i) => on.includes(i));

describe("<Streak>", () => {
  it("seven bars, oldest first, done days marked, then the number", () => {
    const { container } = render(<Streak week={week(0, 4, 5, 6)} n={3} />);
    const s = container.querySelector(".streak")!;
    const bars = [...s.querySelectorAll(".streak-day")];
    expect(bars).toHaveLength(7);
    expect(bars.map((b) => b.classList.contains("on"))).toEqual([true, false, false, false, true, true, true]);
    expect(s.querySelector(".streak-n")!.textContent).toBe("3");
    expect(screen.getByText("3 days in a row")).toHaveClass("visually-hidden");
  });

  it("says 1 day", () => {
    render(<Streak week={week(6)} n={1} />);
    expect(screen.getByText("1 day in a row")).toBeInTheDocument();
  });

  it("still shows at 0 when a day this week was done", () => {
    const { container } = render(<Streak week={week(2)} n={0} />);
    expect(container.querySelector(".streak")).not.toBeNull();
    expect(container.querySelector(".streak-n")!.textContent).toBe("0");
  });

  it("is hidden at 0 with nothing this week", () => {
    const { container } = render(<Streak week={week()} n={0} />);
    expect(container.querySelector(".streak")).toBeNull();
  });

  it("`always` (the Journal's three parts, Esme 2026-11-04): shown at 0 with nothing this week, every bar empty, and 0", () => {
    const { container } = render(<Streak week={week()} n={0} always />);
    expect(container.querySelectorAll(".streak-day")).toHaveLength(7);
    expect(container.querySelectorAll(".streak-day.on")).toHaveLength(0);
    expect(container.querySelector(".streak-n")!.textContent).toBe("0");
    expect(screen.getByText("0 days in a row")).toBeInTheDocument();
  });

  it("has no placeholder star", () => {
    const { container } = render(<Streak week={week(6)} n={1} />);
    expect(container.querySelector(".journal-star")).toBeNull();
    expect(container.textContent).not.toContain("★");
  });
});

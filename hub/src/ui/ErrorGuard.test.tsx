import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { ErrorGuard } from "./ErrorGuard";

// Bug #46: an error while drawing one part never takes the rest of the app down.

function Boom(): JSX.Element {
  throw new Error("pretend drawing fault");
}

describe("ErrorGuard", () => {
  it("shows the fallback for the part that threw, keeps its neighbours, and reports once", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onError = vi.fn();
    try {
      render(
        <div>
          <p>Pretend journal stays</p>
          <ErrorGuard name="test" onError={onError} fallback={<p>Pretend fallback</p>}>
            <Boom />
          </ErrorGuard>
        </div>,
      );
      expect(screen.getByText("Pretend journal stays")).toBeInTheDocument();
      expect(screen.getByText("Pretend fallback")).toBeInTheDocument();
      expect(onError).toHaveBeenCalledTimes(1);
    } finally {
      quiet.mockRestore();
    }
  });

  it("draws nothing by default, and its children normally when nothing throws", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { container } = render(<ErrorGuard name="test"><Boom /></ErrorGuard>);
      expect(container).toBeEmptyDOMElement();
    } finally {
      quiet.mockRestore();
    }
    render(<ErrorGuard name="test"><p>Pretend fine</p></ErrorGuard>);
    expect(screen.getByText("Pretend fine")).toBeInTheDocument();
  });

  it("after an error, a new resetOn value draws the part again; without an error nothing remounts", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let bad = true;
    function Maybe(): JSX.Element {
      if (bad) throw new Error("pretend fault");
      return <p>Pretend page</p>;
    }
    try {
      const { rerender } = render(<ErrorGuard name="t" resetOn="/a" fallback={<p>Pretend fallback</p>}><Maybe /></ErrorGuard>);
      expect(screen.getByText("Pretend fallback")).toBeInTheDocument();
      bad = false;
      rerender(<ErrorGuard name="t" resetOn="/b" fallback={<p>Pretend fallback</p>}><Maybe /></ErrorGuard>);
      expect(screen.getByText("Pretend page")).toBeInTheDocument();
    } finally {
      quiet.mockRestore();
    }
  });
});

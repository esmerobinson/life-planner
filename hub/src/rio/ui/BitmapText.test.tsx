import { render, screen } from "@testing-library/react";
import { BitmapText } from "./BitmapText";

it("keeps the real text for screen readers and hides the drawn canvas", () => {
  const { container } = render(<BitmapText text="Hello Rio" />);
  expect(screen.getByText("Hello Rio")).toBeInTheDocument();
  expect(container.querySelector("canvas")).toHaveAttribute("aria-hidden", "true");
});

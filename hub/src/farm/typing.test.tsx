import { act, fireEvent, render, screen } from "@testing-library/react";
import { useTyping } from "./hooks";

// The phone nook steps aside while she types. When she taps a button under where the nook sits
// (a form's Save at the bottom left), the tap moves focus off the field first: the nook must not
// come back under her finger before that tap lands (the tap would hit the nook, not Save).

function Probe() {
  const typing = useTyping();
  return (
    <div>
      <input aria-label="Field" />
      <button type="button">Save</button>
      <output>{typing ? "typing" : "not typing"}</output>
    </div>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("is true while a text field has focus, false once focus leaves it", () => {
  render(<Probe />);
  act(() => screen.getByLabelText("Field").focus());
  expect(screen.getByRole("status")).toHaveTextContent(/^typing$/);
  act(() => {
    screen.getByRole("button", { name: "Save" }).focus();
    vi.runAllTimers();
  });
  expect(screen.getByRole("status")).toHaveTextContent(/^not typing$/);
});

it("stays true through a press that takes focus away, until the press is released and its click has landed", () => {
  render(<Probe />);
  act(() => screen.getByLabelText("Field").focus());
  const save = screen.getByRole("button", { name: "Save" });
  act(() => {
    fireEvent.pointerDown(save);
    save.focus(); // the press moves focus off the field
    vi.runAllTimers();
  });
  expect(screen.getByRole("status")).toHaveTextContent(/^typing$/);
  act(() => {
    fireEvent.pointerUp(save);
    fireEvent.click(save);
    vi.runAllTimers();
  });
  expect(screen.getByRole("status")).toHaveTextContent(/^not typing$/);
});

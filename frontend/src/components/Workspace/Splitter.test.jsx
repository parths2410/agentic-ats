import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Splitter from "./Splitter.jsx";

const KEY = "test.split.fraction";

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});


function renderSplitter(overrides = {}) {
  return render(
    <Splitter
      storageKey={KEY}
      defaultFraction={0.4}
      min={0.25}
      max={0.75}
      left={<div data-testid="left">L</div>}
      right={<div data-testid="right">R</div>}
      {...overrides}
    />,
  );
}


describe("Splitter", () => {
  it("renders both children", () => {
    renderSplitter();
    expect(screen.getByTestId("left")).toBeInTheDocument();
    expect(screen.getByTestId("right")).toBeInTheDocument();
  });

  it("uses the default fraction when localStorage is empty", () => {
    renderSplitter();
    const handle = screen.getByRole("separator");
    expect(handle).toHaveAttribute("aria-valuenow", "40");
  });

  it("loads the persisted fraction from localStorage on mount", () => {
    window.localStorage.setItem(KEY, "0.6");
    renderSplitter();
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "60");
  });

  it("clamps an out-of-bounds persisted value into [min, max]", () => {
    window.localStorage.setItem(KEY, "0.95");
    renderSplitter();
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "75");
  });

  it("falls back to default when the persisted value is not a number", () => {
    window.localStorage.setItem(KEY, "not-a-number");
    renderSplitter();
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "40");
  });

  it("ArrowRight nudges the fraction up and persists", () => {
    renderSplitter();
    const handle = screen.getByRole("separator");
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "42");
    expect(window.localStorage.getItem(KEY)).toBe("0.42");
  });

  it("ArrowLeft nudges the fraction down and persists", () => {
    renderSplitter();
    const handle = screen.getByRole("separator");
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", "38");
    expect(window.localStorage.getItem(KEY)).toBe("0.38");
  });

  it("ArrowLeft / ArrowRight clamp at min and max", () => {
    renderSplitter({ defaultFraction: 0.25 });
    const handle = screen.getByRole("separator");
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", "25");
  });

  it("double-click resets to the default fraction", () => {
    window.localStorage.setItem(KEY, "0.7");
    renderSplitter();
    const handle = screen.getByRole("separator");
    expect(handle).toHaveAttribute("aria-valuenow", "70");
    fireEvent.doubleClick(handle);
    expect(handle).toHaveAttribute("aria-valuenow", "40");
    expect(window.localStorage.getItem(KEY)).toBe("0.4");
  });

  it("mouse drag updates the fraction relative to the container width", () => {
    const { container } = renderSplitter();
    const handle = screen.getByRole("separator");
    const wrapper = container.querySelector(".splitter");
    wrapper.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 1000, bottom: 100,
      width: 1000, height: 100, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.mouseDown(handle, { button: 0 });
    fireEvent.mouseMove(document, { clientX: 600 });
    expect(handle).toHaveAttribute("aria-valuenow", "60");
    fireEvent.mouseUp(document);
    expect(window.localStorage.getItem(KEY)).toBe("0.6");
  });

  it("mouse drag clamps at min and max bounds", () => {
    const { container } = renderSplitter();
    const handle = screen.getByRole("separator");
    const wrapper = container.querySelector(".splitter");
    wrapper.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 1000, bottom: 100,
      width: 1000, height: 100, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.mouseDown(handle, { button: 0 });
    fireEvent.mouseMove(document, { clientX: 50 });
    expect(handle).toHaveAttribute("aria-valuenow", "25");
    fireEvent.mouseMove(document, { clientX: 950 });
    expect(handle).toHaveAttribute("aria-valuenow", "75");
  });

  it("mouseDown with non-primary button does not start dragging", () => {
    const { container } = renderSplitter();
    const handle = screen.getByRole("separator");
    const wrapper = container.querySelector(".splitter");
    wrapper.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 1000, bottom: 100,
      width: 1000, height: 100, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.mouseDown(handle, { button: 2 });
    fireEvent.mouseMove(document, { clientX: 800 });
    expect(handle).toHaveAttribute("aria-valuenow", "40");
  });

  it("handles localStorage being unavailable gracefully", () => {
    const setItemSpy = vi
      .spyOn(window.localStorage.__proto__, "setItem")
      .mockImplementation(() => {
        throw new Error("storage disabled");
      });
    renderSplitter();
    const handle = screen.getByRole("separator");
    handle.focus();
    expect(() => fireEvent.keyDown(handle, { key: "ArrowRight" })).not.toThrow();
    expect(handle).toHaveAttribute("aria-valuenow", "42");
    setItemSpy.mockRestore();
  });
});

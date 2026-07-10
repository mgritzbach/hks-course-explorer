import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LandingSplash from "../components/LandingSplash.jsx";

describe("LandingSplash", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("presents the requested HKS welcome content and continues directly without a tutorial", () => {
    const onDirect = vi.fn();
    render(<LandingSplash onDirect={onDirect} onTutorial={vi.fn()} />);

    expect(
      screen.getByRole("heading", {
        name: "Welcome to the HKS Course Explorer",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Disclaimer")).toBeTruthy();
    expect(screen.getByText("Attention")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Continue directly without the tutorial",
      }),
    );
    act(() => vi.advanceTimersByTime(280));

    expect(window.localStorage.getItem("hks-splash-shown")).toBe("1");
    expect(onDirect).toHaveBeenCalledOnce();
  });

  it("offers the guided tutorial as a distinct first-visit action", () => {
    const onTutorial = vi.fn();
    render(<LandingSplash onDirect={vi.fn()} onTutorial={onTutorial} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Continue with the guided tutorial" }),
    );
    act(() => vi.advanceTimersByTime(280));

    expect(window.localStorage.getItem("hks-splash-shown")).toBe("1");
    expect(onTutorial).toHaveBeenCalledOnce();
  });

  it("keeps reverse keyboard navigation inside the welcome dialog", () => {
    render(<LandingSplash onDirect={vi.fn()} onTutorial={vi.fn()} />);

    const dialog = screen.getByRole("dialog", {
      name: "Welcome to the HKS Course Explorer",
    });
    const tutorial = screen.getByRole("button", {
      name: "Continue with the guided tutorial",
    });
    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(tutorial);
  });
});

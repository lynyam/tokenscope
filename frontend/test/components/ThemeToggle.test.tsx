import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ThemeProvider } from "next-themes";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Toaster } from "@/components/ui/sonner";

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: false, addListener: vi.fn(), removeListener: vi.fn(),
  }));
});
afterEach(() => {
  toast.dismiss();
  document.documentElement.classList.remove("dark", "light");
  document.documentElement.style.colorScheme = "";
});

it("uses the same saved theme for the page and notifications, including after remount", async () => {
  const ui = <ThemeProvider attribute="class" defaultTheme="system"><ThemeToggle /><Toaster /></ThemeProvider>;
  const view = render(ui);
  act(() => { toast("Theme test"); });
  await screen.findByText("Theme test");
  fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
  expect(document.documentElement).toHaveClass("dark");
  expect(localStorage.getItem("theme")).toBe("dark");
  expect(document.querySelector("[data-sonner-toaster]")).toHaveAttribute("data-sonner-theme", "dark");
  view.unmount();
  render(ui);
  act(() => { toast("Remounted theme test"); });
  await screen.findByText("Remounted theme test");
  expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
  expect(document.documentElement).not.toHaveClass("dark");
  expect(document.querySelector("[data-sonner-toaster]")).toHaveAttribute("data-sonner-theme", "light");
});

it("still renders and toggles when browser storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
  render(<ThemeProvider attribute="class"><ThemeToggle /></ThemeProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
  expect(document.documentElement).toHaveClass("dark");
});

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "next-themes";
import { MemoryRouter } from "react-router-dom";
import { ProductPreview } from "@/components/ProductPreview";
import { LandingPage } from "@/pages/LandingPage";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: null, isLoading: false }),
}));

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: false, addListener: vi.fn(), removeListener: vi.fn(),
  }));
});

afterEach(() => {
  document.documentElement.classList.remove("dark", "light");
  document.documentElement.style.colorScheme = "";
});

const views = [
  ["Analytics overview", "/screenshots/3.webp"],
  ["Costs and tokens", "/screenshots/2.webp"],
  ["AI assistant", "/screenshots/1.webp"],
  ["Light-theme preview", "/screenshots/4.webp"],
] as const;

describe("landing product screenshots", () => {
  it("labels the images as static demo data and starts with analytics", () => {
    render(<ProductPreview />);
    expect(screen.getByText(/Static screenshots.*Demo data.*Estimated costs/)).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "/screenshots/3.webp");
    expect(screen.getByRole("img")).toHaveAttribute("loading", "lazy");
    expect(screen.getByRole("button", { name: "Analytics overview" })).toHaveAttribute("aria-pressed", "true");
  });

  it.each(views)("selects %s and links to that exact full-size asset", async (label, src) => {
    const user = userEvent.setup();
    render(<ProductPreview />);
    await user.click(screen.getByRole("button", { name: label }));
    const group = screen.getByRole("group", { name: "Choose a product screenshot" });
    expect(within(group).getAllByRole("button", { pressed: true })).toHaveLength(1);
    expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
    const image = screen.getByRole("img");
    expect(image).toHaveAttribute("src", src);
    expect(image.getAttribute("alt")?.length).toBeGreaterThan(20);
    expect(Number(image.getAttribute("width"))).toBeGreaterThan(0);
    expect(Number(image.getAttribute("height"))).toBeGreaterThan(0);
    const link = screen.getByRole("link", { name: `Open ${label} screenshot in a new tab` });
    expect(link).toHaveAttribute("href", src);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toContainElement(image);
  });

  it("supports keyboard selection without moving focus to the image", async () => {
    const user = userEvent.setup();
    render(<ProductPreview />);
    await user.tab();
    expect(screen.getByRole("button", { name: "Analytics overview" })).toHaveFocus();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Costs and tokens" })).toHaveFocus();
    expect(screen.getByRole("img")).toHaveAttribute("src", "/screenshots/2.webp");
    await user.tab();
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "AI assistant" })).toHaveFocus();
    expect(screen.getByRole("img")).toHaveAttribute("src", "/screenshots/1.webp");
  });

  it("uses the shared page theme while screenshot selection remains independent", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const view = render(
      <MemoryRouter>
        <ThemeProvider attribute="class" defaultTheme="light">
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>,
    );
    // A nested dark class defeats the global theme toggle even when <html> changes.
    expect(screen.getByRole("main").parentElement).not.toHaveClass("dark");
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement).toHaveClass("dark");
    fireEvent.click(screen.getByRole("button", { name: "Light-theme preview" }));
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement).not.toHaveClass("dark");
    expect(screen.getByRole("figure")).toContainElement(screen.getByRole("img"));
    expect(screen.getByRole("img", { name: /analytics filters/i })).toHaveAttribute("src", "/screenshots/4.webp");
    expect(localStorage.getItem("theme")).toBe("light");
    expect(fetch).not.toHaveBeenCalled();
    view.unmount();
  });
});

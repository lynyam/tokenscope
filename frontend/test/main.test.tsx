import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const root = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("react-dom/client", () => ({ default: { createRoot: () => root } }));

beforeEach(() => {
  root.render.mockClear();
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: false, addListener: vi.fn(), removeListener: vi.fn(),
  }));
  vi.stubGlobal("scrollTo", vi.fn());
});

it("the real entry point leaves public legal routes outside authentication", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("Backend unavailable"));
  vi.stubGlobal("fetch", fetch);
  localStorage.setItem("tokenscope.accessToken", "invalid-token");
  window.history.replaceState({}, "", "/privacy");
  await import("@/main");
  expect(root.render).toHaveBeenCalledTimes(1);
  render(root.render.mock.calls[0][0] as ReactNode);
  expect(await screen.findByRole("heading", { name: "Privacy Policy" })).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
  expect(localStorage.getItem("tokenscope.accessToken")).toBe("invalid-token");
});

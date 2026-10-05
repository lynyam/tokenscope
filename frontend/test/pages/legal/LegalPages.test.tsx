import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppRouter } from "@/router/AppRouter";
import { getAccessToken, saveAccessToken } from "@/api/auth-session";

const fetchMock = vi.fn();

const legalPages = [
  {
    path: "/privacy",
    heading: "Privacy Policy",
    title: "Privacy Policy — TokenScope",
  },
  {
    path: "/terms",
    heading: "Terms of Service",
    title: "Terms of Service — TokenScope",
  },
];

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  document.title = "TokenScope";
  localStorage.clear();

  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new TypeError("Backend unavailable"));
  vi.stubGlobal("fetch", fetchMock);
});

describe.each(legalPages)("$heading public access", ({
  path,
  heading,
  title,
}) => {
  it("opens while signed out without contacting the backend", async () => {
    window.history.replaceState({}, "", path);

    render(<AppRouter />);

    expect(
      await screen.findByRole("heading", { level: 1, name: heading }),
    ).toBeInTheDocument();

    expect(document.title).toBe(title);
    expect(window.location.pathname).toBe(path);
    expect(getAccessToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves an invalid stored token without verifying it", async () => {
    saveAccessToken("invalid-test-token");
    window.history.replaceState({}, "", path);

    render(<AppRouter />);

    expect(
      await screen.findByRole("heading", { level: 1, name: heading }),
    ).toBeInTheDocument();

    expect(document.title).toBe(title);
    expect(getAccessToken()).toBe("invalid-test-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens from a failed session and resumes verification on return", async () => {
    const user = userEvent.setup();
    saveAccessToken("existing-test-token");

    render(<AppRouter />);

    expect(
      await screen.findByRole("heading", {
        name: "Unable to verify your session",
      }),
    ).toBeInTheDocument();

    expect(getAccessToken()).toBe("existing-test-token");

    const verificationCalls = fetchMock.mock.calls.length;
    expect(verificationCalls).toBeGreaterThan(0);

    await user.click(screen.getByRole("link", { name: heading }));

    expect(
      await screen.findByRole("heading", { level: 1, name: heading }),
    ).toBeInTheDocument();

    expect(window.location.pathname).toBe(path);
    expect(document.title).toBe(title);
    expect(getAccessToken()).toBe("existing-test-token");
    expect(fetchMock).toHaveBeenCalledTimes(verificationCalls);

    await user.click(screen.getByRole("link", { name: "Back to home" }));

    expect(
      await screen.findByRole("heading", {
        name: "Unable to verify your session",
      }),
    ).toBeInTheDocument();

    expect(window.location.pathname).toBe("/");
    expect(fetchMock.mock.calls.length).toBeGreaterThan(verificationCalls);
    expect(getAccessToken()).toBe("existing-test-token");
  });
});

// frontend/src/test/context/AuthContext.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuthContext } from "../../context/AuthContext";
import * as httpClient from "../../api/http-client";

// Minimal consumer component, used only to surface context state as
// visible text so assertions can check rendered output.
function AuthStatusProbe() {
  const { user, isLoading } = useAuthContext();
  if (isLoading) return <div>Loading...</div>;
  return <div>{user ? `Logged in as ${user.displayName}` : "No user"}</div>;
}

describe("AuthProvider — session restoration on startup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("calls GET /auth/me and shows the user when a token is already stored", async () => {
    localStorage.setItem("tokenscope_access_token", "existing-token");
    const spy = vi.spyOn(httpClient, "apiRequest").mockResolvedValue({
      id: "1",
      email: "a@b.com",
      displayName: "Alice",
    });

    render(
      <AuthProvider>
        <AuthStatusProbe />
      </AuthProvider>,
    );

    const expectedText = "Logged in as Alice";

    await waitFor(() => {
      const actualText = screen.getByText(expectedText).textContent;
      console.log("expected text:", expectedText);
      console.log("actual text:  ", actualText);
      expect(actualText).toBe(expectedText);
    });

    expect(spy).toHaveBeenCalledWith("/auth/me");
  });

  it("shows 'No user' without calling apiRequest when no token is stored", async () => {
    const spy = vi.spyOn(httpClient, "apiRequest");

    render(
      <AuthProvider>
        <AuthStatusProbe />
      </AuthProvider>,
    );

    const expectedText = "No user";
    const expectedCallCount = 0;

    await waitFor(() => {
      const actualText = screen.getByText(expectedText).textContent;
      console.log("expected text:", expectedText);
      console.log("actual text:  ", actualText);
      expect(actualText).toBe(expectedText);
    });

    const actualCallCount = spy.mock.calls.length;
    console.log("expected apiRequest calls:", expectedCallCount);
    console.log("actual apiRequest calls:  ", actualCallCount);
    expect(actualCallCount).toBe(expectedCallCount);
  });
});
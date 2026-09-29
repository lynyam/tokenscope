import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuthContext } from "@/context/AuthContext";
import { clearAuthSession, getAccessToken, saveAccessToken } from "@/api/auth-session";
import { getCurrentUser } from "@/api/auth.api";
import type { User } from "@/types/workspace.types";

vi.mock("@/api/auth.api", () => ({
  getCurrentUser: vi.fn(), signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(),
}));

function Session() {
  const { user, isLoading } = useAuthContext();
  return <div>{isLoading ? "Loading" : user?.displayName ?? "Signed out"}</div>;
}

describe("AuthContext invalidation", () => {
  it("clears rendered user state when the HTTP layer invalidates auth", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "alice", displayName: "Alice", email: "alice@example.test" });
    saveAccessToken("alice-token");
    render(<AuthProvider><Session /></AuthProvider>);
    await screen.findByText("Alice");
    act(() => clearAuthSession());
    expect(screen.getByText("Signed out")).toBeInTheDocument();
    expect(getAccessToken()).toBeNull();
  });

  it("does not restore a user from a startup request completed after invalidation", async () => {
    let finish!: (user: User) => void;
    vi.mocked(getCurrentUser).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<AuthProvider><Session /></AuthProvider>);
    expect(screen.getByText("Loading")).toBeInTheDocument();
    act(() => clearAuthSession());
    await act(async () => finish({ id: "alice", displayName: "Alice", email: "alice@example.test" }));
    expect(screen.getByText("Signed out")).toBeInTheDocument();
  });
});

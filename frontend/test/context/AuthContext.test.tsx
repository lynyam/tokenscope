import {
  act,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  AuthProvider,
  useAuthContext,
} from "@/context/AuthContext";

import {
  getCurrentUser,
  signIn as apiSignIn,
  signUp as apiSignUp,
} from "@/api/auth.api";

import {
  clearAuthSession,
  getAccessToken,
  saveAccessToken,
} from "@/api/auth-session";

import { ApiError } from "@/api/http-client";
import type {
  AuthResponse,
  User,
} from "@/types/workspace.types";

import { MemoryRouter } from "react-router-dom";

vi.mock("@/api/auth.api", () => ({
  getCurrentUser: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

const alice: User = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "alice@example.test",
  displayName: "Alice",
};

const authenticated: AuthResponse = {
  user: alice,
  accessToken: "new-test-token",
  tokenType: "Bearer",
  expiresIn: 3600,
};

const credentials = {
  email: alice.email,
  password: "test-password",
};

function Session() {
  const { user, isLoading, signIn, signUp, signOut } =
    useAuthContext();

  return (
    <>
      <p>{isLoading ? "Loading" : user?.displayName ?? "Signed out"}</p>

      {/* Rejected actions are consumed by this test-only UI. */}
      <button
        onClick={() => void signIn(credentials).catch(() => {})}
      >
        Sign in
      </button>

      <button
        onClick={() =>
          void signUp({
            ...credentials,
            displayName: alice.displayName,
          }).catch(() => {})
        }
      >
        Sign up
      </button>

      <button onClick={() => void signOut()}>
        Sign out
      </button>
    </>
  );
}

function renderSession() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Session />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(alice);
});

describe("AuthContext session lifecycle", () => {
  it("skips /auth/me when there is no token", async () => {
    renderSession();

    await screen.findByText("Signed out");
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("clears the rendered user after session invalidation", async () => {
    saveAccessToken("existing-test-token");
    renderSession();

    await screen.findByText("Alice");
    act(() => clearAuthSession());

    expect(screen.getByText("Signed out")).toBeInTheDocument();
    expect(getAccessToken()).toBeNull();
  });

  it("ignores a startup response completed after invalidation", async () => {
    let finish!: (value: User) => void;

    vi.mocked(getCurrentUser).mockReturnValue(
      new Promise<User>(resolve => {
        finish = resolve;
      }),
    );

    // Startup verification now correctly requires an existing token.
    saveAccessToken("existing-test-token");
    renderSession();

    expect(screen.getByText("Loading")).toBeInTheDocument();

    act(() => clearAuthSession());
    await act(async () => finish(alice));

    expect(screen.getByText("Signed out")).toBeInTheDocument();
    expect(getAccessToken()).toBeNull();
  });

  it.each(["signIn", "signUp"] as const)(
    "%s commits the safe user and only the access token",
    async operation => {
      const method = operation === "signIn" ? apiSignIn : apiSignUp;
      vi.mocked(method).mockResolvedValue(authenticated);

      renderSession();
      await screen.findByText("Signed out");

      fireEvent.click(
        screen.getByText(operation === "signIn" ? "Sign in" : "Sign up"),
      );

      await screen.findByText("Alice");
      expect(getAccessToken()).toBe("new-test-token");
      expect(Object.keys(localStorage)).toEqual([
        "tokenscope.accessToken",
      ]);
    },
  );

  it.each(["signIn", "signUp"] as const)(
    "does not restore authentication when late %s completes after logout",
    async operation => {
      let finish!: (value: AuthResponse) => void;
      const method = operation === "signIn" ? apiSignIn : apiSignUp;

      vi.mocked(method).mockReturnValue(
        new Promise<AuthResponse>(resolve => {
          finish = resolve;
        }),
      );

      renderSession();
      await screen.findByText("Signed out");

      fireEvent.click(
        screen.getByText(operation === "signIn" ? "Sign in" : "Sign up"),
      );
      fireEvent.click(screen.getByText("Sign out"));

      await act(async () => finish(authenticated));

      expect(getAccessToken()).toBeNull();
      expect(screen.getByText("Signed out")).toBeInTheDocument();
    },
  );

  it.each([
    new ApiError(undefined, "NETWORK_ERROR", "Unable to reach the server."),
    new ApiError(500, "INTERNAL_SERVER_ERROR", "Server error."),
    new ApiError(503, "SERVICE_UNAVAILABLE", "Service unavailable."),
  ])("preserves the token and retries verification: %s", async failure => {
    saveAccessToken("existing-test-token");

    vi.mocked(getCurrentUser)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(alice);

    renderSession();

    await screen.findByRole("alert");
    expect(getAccessToken()).toBe("existing-test-token");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await screen.findByText("Alice");
    expect(getCurrentUser).toHaveBeenCalledTimes(2);
    expect(getAccessToken()).toBe("existing-test-token");
  });

  it("signs out locally without an HTTP request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    saveAccessToken("existing-test-token");

    renderSession();
    await screen.findByText("Alice");

    fireEvent.click(screen.getByText("Sign out"));

    expect(getAccessToken()).toBeNull();
    expect(screen.getByText("Signed out")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("removes obsolete authentication records and preserves preferences", async () => {
    const obsoleteKeys = [
      "mockSession",
      "mockUsersData",
      "mockAccountsData",
      "tokenscope_access_token",
      "access_token",
    ];

    for (const key of obsoleteKeys) {
      localStorage.setItem(key, "obsolete-test-data");
    }
    localStorage.setItem("theme", "dark");

    renderSession();
    await screen.findByText("Signed out");

    for (const key of obsoleteKeys) {
      expect(localStorage.getItem(key)).toBeNull();
    }
    expect(localStorage.getItem("theme")).toBe("dark");
  });
});

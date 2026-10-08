import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

import { useAuthContext } from "@/context/AuthContext";
import { ApiError } from "@/api/http-client";
import { SignInPage } from "@/pages/auth/SignInPage";
import { SignUpPage } from "@/pages/auth/SignUpPage";
import type {
  SignInInput,
  SignUpInput,
} from "@/types/workspace.types";

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: vi.fn(),
}));

const authenticate =
  vi.fn<(input: SignInInput | SignUpInput) => Promise<void>>();

beforeEach(() => {
  authenticate.mockReset();

  vi.mocked(useAuthContext).mockReturnValue({
    user: null,
    isLoading: false,
    signIn: authenticate,
    signUp: authenticate,
    signOut: vi.fn(async () => {}),
  });
});

it.each([
  { name: "sign-in", Page: SignInPage, signup: false },
  { name: "sign-up", Page: SignUpPage, signup: true },
])("$name prevents duplicate requests and displays connection errors", async test => {
  let rejectRequest!: (error: Error) => void;

  authenticate.mockReturnValue(
    new Promise<void>((_, reject) => {
      rejectRequest = reject;
    }),
  );

  render(
    <MemoryRouter>
      <test.Page />
    </MemoryRouter>,
  );

  const user = userEvent.setup();

  if (test.signup) {
    await user.type(screen.getByLabelText("Name"), "Alice");
  }
  await user.type(screen.getByLabelText("Email"), "alice@example.test");
  await user.type(screen.getByLabelText("Password"), "password-123");

  const form = screen.getByLabelText("Email").closest("form")!;

  fireEvent.submit(form);
  fireEvent.submit(form);

  await waitFor(() => {
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  expect(screen.getByRole("button")).toBeDisabled();

  await act(async () => {
    rejectRequest(
      new ApiError(
        undefined,
        "NETWORK_ERROR",
        "Unable to reach the server.",
      ),
    );
  });

  expect(await screen.findByRole("alert"))
    .toHaveTextContent("Unable to reach the server.");

  expect(screen.getByRole("button")).not.toBeDisabled();
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useOrganizationRole } from "@/hooks/useOrganizationRole";
import { getAccessToken, saveAccessToken } from "@/api/auth-session";

const response = (role: string) => new Response(JSON.stringify({ currentUserRole: role }), {
  headers: { "Content-Type": "application/json" },
});

it("revalidates on navigation and never displays an old role while the next read is pending", async () => {
  saveAccessToken("role-test");
  let finish!: (value: Response) => void;
  const fetchMock = vi.fn().mockResolvedValueOnce(response("OWNER"))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetchMock);
  const { result, rerender } = renderHook(({ scope }) => useOrganizationRole("org", true, scope), {
    initialProps: { scope: "/overview" },
  });
  await waitFor(() => expect(result.current.role).toBe("OWNER"));
  rerender({ scope: "/settings" });
  expect(result.current.role).toBeNull();
  await act(async () => finish(response("MEMBER")));
  expect(result.current.role).toBe("MEMBER");
  expect(getAccessToken()).toBe("role-test");
});

it("aborts a previous organization's read and ignores its late response", async () => {
  saveAccessToken("role-test");
  let finishOld!: (value: Response) => void;
  const fetchMock = vi.fn()
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValueOnce(response("MEMBER"));
  vi.stubGlobal("fetch", fetchMock);
  const { result, rerender } = renderHook(({ org }) => useOrganizationRole(org), { initialProps: { org: "old" } });
  rerender({ org: "new" });
  await waitFor(() => expect(result.current.role).toBe("MEMBER"));
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => finishOld(response("OWNER")));
  expect(result.current.role).toBe("MEMBER");
  expect(getAccessToken()).toBe("role-test");
});

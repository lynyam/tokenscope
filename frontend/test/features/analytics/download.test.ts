import { afterEach, expect, it, vi } from "vitest";
import { downloadBlob } from "../../../src/features/analytics/download";

afterEach(() => vi.useRealTimers());

it.each(["success", "click failure", "append failure"])("releases the object URL after %s", outcome => {
  vi.useFakeTimers();
  const revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:export"), revokeObjectURL: revoke });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
    if (outcome === "click failure") throw new Error("download blocked");
  });
  if (outcome === "append failure") {
    vi.spyOn(document.body, "appendChild").mockImplementation(() => { throw new Error("DOM unavailable"); });
  }
  const download = () => downloadBlob(new Blob(["report"]), "report.csv");
  if (outcome === "success") { download(); expect(click).toHaveBeenCalledOnce(); }
  else expect(download).toThrow();
  expect(document.querySelector('a[download]')).toBeNull();
  expect(revoke).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:export");
});

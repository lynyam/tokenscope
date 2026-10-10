import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface RevealedApiKey {
  name: string;
  keyPrefix: string;
  key: string;
}

type CopyState = "idle" | "copied" | "failed";

// The secret lives only in this component's props/state. The parent unmounts
// it on close, navigation, permission loss, or project change.
export function ApiKeySecretDialog({ revealed, onClose }: {
  revealed: RevealedApiKey;
  onClose: () => void;
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  async function handleCopy() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(revealed.key);
      setCopyState("copied"); // only after the clipboard really accepted it
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="rounded-lg">
        <DialogHeader>
          <DialogTitle>Copy your new API key</DialogTitle>
          <DialogDescription>
            This is the only time the full key is shown. Once you close this window it cannot be displayed again.
            If you lose it, revoke it and create a new one.
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm">
          <strong>{revealed.name}</strong> <code>{revealed.keyPrefix}…</code>
        </p>

        <textarea
          readOnly
          rows={3}
          aria-label="API key"
          value={revealed.key}
          autoFocus
          onFocus={event => event.currentTarget.select()}
          className="w-full resize-none break-all rounded-md border p-2 font-mono text-sm"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={handleCopy}>Copy</Button>
          {copyState === "copied" && <span role="status" className="text-sm">Copied to clipboard.</span>}
          {copyState === "failed" && (
            <span role="alert" className="text-sm text-destructive">
              Copy failed. Select the key above and copy it manually.
            </span>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          This key belongs to the project. It allows trace creation, reading, correction and deletion within this
          project. It does not provide access to organization management, documents or the assistant.
        </p>

        <Button type="button" variant="outline" onClick={onClose}>I have saved this key</Button>
      </DialogContent>
    </Dialog>
  );
}
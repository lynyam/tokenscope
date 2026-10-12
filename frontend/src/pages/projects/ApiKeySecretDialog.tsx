import { useRef, useState } from "react";
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
//
// Only the explicit "I have saved this key" button closes the dialog directly.
// Escape, an outside click and the corner close button ask for confirmation
// first, because closing discards the only copy the browser will ever show.
export function ApiKeySecretDialog({ revealed, onClose }: {
  revealed: RevealedApiKey;
  onClose: () => void;
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [confirmingClose, setConfirmingClose] = useState(false);
  const keyField = useRef<HTMLTextAreaElement>(null);

  async function handleCopy() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(revealed.key);
      setCopyState("copied"); // only after the clipboard really accepted it
    } catch {
      setCopyState("failed");
    }
  }

  function keepVisible() {
    setConfirmingClose(false);
    keyField.current?.focus();
  }

  // `open` is always true here, so Base UI never closes the dialog by itself:
  // every dismissal attempt only reaches this handler.
  function handleOpenChange(open: boolean) {
    if (open) return;
    if (confirmingClose) keepVisible(); // a second Escape goes back to the key
    else setConfirmingClose(true);
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
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
          ref={keyField}
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

        {confirmingClose ? (
          <div role="alert" className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">Close without saving?</p>
            <p className="text-sm text-muted-foreground">
              This key cannot be shown again. If you close now, you will have to revoke it and create a new one.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" autoFocus onClick={keepVisible}>Keep key visible</Button>
              <Button type="button" variant="outline" onClick={onClose}>Close and discard</Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="outline" onClick={onClose}>I have saved this key</Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

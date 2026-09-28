import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormEvent } from "react";

type EditProjectFormProps = {
  nameDraft: string;
  setNameDraft: (value: string) => void;
  descriptionDraft: string;
  setDescriptionDraft: (value: string) => void;
  isSaving: boolean;
  saveError: string | null;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
};

export function EditProjectForm({
  nameDraft,
  setNameDraft,
  descriptionDraft,
  setDescriptionDraft,
  isSaving,
  saveError,
  onSubmit,
  onCancel,
}: EditProjectFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-name">Name</Label>
        <Input
          id="edit-name"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          disabled={isSaving}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-description">Description</Label>
        <Input
          id="edit-description"
          value={descriptionDraft}
          onChange={(e) => setDescriptionDraft(e.target.value)}
          disabled={isSaving}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" className="rounded-lg" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </Button>
        <Button type="button" className="rounded-lg" variant="outline" disabled={isSaving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {saveError && <p className="text-sm text-destructive">{saveError}</p>}
    </form>
  );
}
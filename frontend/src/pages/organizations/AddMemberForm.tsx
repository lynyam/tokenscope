import { useRef, useState, type FormEvent } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, getApiErrorMessage, isAbortError } from "../../api/http-client";
import type { AddOrganizationMemberInput, MembershipRole } from "../../types/workspace.types";

interface AddMemberFormProps {
  onAdd: (input: AddOrganizationMemberInput) => Promise<void>;
}

export function AddMemberForm({ onAdd }: AddMemberFormProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MembershipRole>("MEMBER");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submitting = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await onAdd({ email, role });
      setEmail("");
      setRole("MEMBER");
      setOpen(false);
    } catch (failure) {
      if (!isAbortError(failure)) setError(failure);
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!submitting.current) setOpen(next); }}>
      <DialogTrigger className="inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground h-10 px-6">
        Add member
      </DialogTrigger>
      <DialogContent className="rounded-lg" showCloseButton={!isSubmitting}>
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>Add someone who already has a TokenScope account.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3" aria-busy={isSubmitting}>
          <Label htmlFor="member-email">Email</Label>
          <Input id="member-email" type="email" required maxLength={254} value={email}
            onChange={event => setEmail(event.target.value)} disabled={isSubmitting} />
          <Label htmlFor="member-role">Role</Label>
          <select id="member-role" value={role} disabled={isSubmitting}
            onChange={event => setRole(event.target.value as MembershipRole)}
            className="rounded-lg border border-border bg-transparent h-10 px-3">
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
            <option value="OWNER">Owner</option>
          </select>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Adding…" : "Add member"}</Button>
          {error !== null && (
            <div role="alert" className="text-sm text-destructive">
              <p>{getApiErrorMessage(error, "Unable to add the member. Please try again.")}</p>
              {error instanceof ApiError && error.details?.map(detail => (
                <p key={detail.field}>{detail.field}: {detail.messages.join(" ")}</p>
              ))}
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

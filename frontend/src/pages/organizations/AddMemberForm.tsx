import { useState, type FormEvent } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { addOrganizationMember } from "../../api/memberships.api";
import { MockApiError } from "../../api/mock-api.utils";
import type { MembershipRole, MembershipWithUser } from "../../types/workspace.types";

interface AddMemberFormProps {
    organizationId: string;
    onMemberAdded: (membership: MembershipWithUser) => void;
}

export function AddMemberForm({ organizationId, onMemberAdded }: AddMemberFormProps) {
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<MembershipRole>("MEMBER");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<MockApiError | null>(null);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        setIsSubmitting(true);
        setSubmitError(null);

        try {
            const newMembership = await addOrganizationMember(organizationId, { email, role });
            onMemberAdded(newMembership);
            setEmail("");
            setRole("MEMBER");
            setOpen(false);
        } catch (error: unknown) {
            setSubmitError(error instanceof MockApiError ? error : null);
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/80 h-10 px-6 text-sm font-medium normal-case transition-all">
                Add member
            </DialogTrigger>
            <DialogContent className="rounded-lg">
                <DialogHeader>
                    <DialogTitle>Add member</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="member-email">Email</Label>
                        <Input
                            id="member-email"
                            name="email"
                            type="email"
                            placeholder="member@example.com"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            disabled={isSubmitting}
                            required
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="member-role">Role</Label>
                        <select
                            id="member-role"
                            name="role"
                            value={role}
                            onChange={(event) => setRole(event.target.value as MembershipRole)}
                            disabled={isSubmitting}
                            className="rounded-lg border border-border bg-transparent h-10 px-3 text-sm"
                        >
                            <option value="MEMBER">Member</option>
                            <option value="ADMIN">Admin</option>
                            <option value="OWNER">Owner</option>
                        </select>
                    </div>

                    <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? "Adding..." : "Add member"}
                    </Button>

                    {submitError && (
                        <p role="alert" className="text-sm text-destructive">
                            {submitError.message}
                        </p>
                    )}
                </form>
            </DialogContent>
        </Dialog>
    );
}
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

export function AddMemberForm() {
  return (
    <Dialog>
      <DialogTrigger className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/80 h-10 px-6 text-sm font-medium normal-case transition-all">
        Add member
      </DialogTrigger>
      <DialogContent className="rounded-lg">
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
        </DialogHeader>

        <form className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-email">Email</Label>
            <Input
              id="member-email"
              name="email"
              type="email"
              placeholder="member@example.com"
              disabled
            />
          </div>

          <Button type="submit" disabled>
            Add member
          </Button>

          <p className="text-sm text-muted-foreground">
            Adding members will be available in a future update.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}

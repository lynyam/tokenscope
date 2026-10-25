import { Injectable, Logger } from "@nestjs/common";

export type AccessChange =
  | { kind: "membership.removed"; organizationId: string; userId: string }
  | { kind: "project.archived"; organizationId: string; projectId: string }
  | { kind: "organization.archived"; organizationId: string };

type Listener = (change: AccessChange) => void | Promise<void>;

@Injectable()
export class AccessChangesService {
  private readonly logger = new Logger(AccessChangesService.name);
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // Call after commit. A notification failure must not undo HTTP success.
  async publish(change: AccessChange): Promise<void> {
    const event = Object.freeze({ ...change });
    const results = await Promise.allSettled(
      [...this.listeners].map(listener => Promise.resolve().then(() => listener(event))),
    );
    if (results.some(result => result.status === "rejected")) {
      this.logger.warn({ event: "access_change_publication_failed", kind: change.kind });
    }
  }
}

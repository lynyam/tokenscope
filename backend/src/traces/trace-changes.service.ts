import { Injectable } from "@nestjs/common";

export interface TraceChange {
	projectId: string;
}

type Listener = (change: TraceChange) => void | Promise<void>;

@Injectable()
export class TraceChangesService {
	private readonly listeners = new Set<Listener>();

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async publish(change: TraceChange): Promise<void> {
		const event = Object.freeze({ projectId: change.projectId });

		const results = await Promise.allSettled(
			[...this.listeners].map(listener =>
				Promise.resolve().then(() => listener(event)),
			),
		);

		if (results.some(result => result.status === "rejected")) {
			throw new Error("Trace change publication failed.");
		}
	}
}

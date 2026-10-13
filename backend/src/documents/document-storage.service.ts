import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createReadStream, type ReadStream } from "node:fs";
import { mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export const DOCUMENT_STORAGE_ROOT = Symbol("DOCUMENT_STORAGE_ROOT");

const KEY_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Stores opaque blobs under a root directory. Keys are generated here only. */
@Injectable()
export class DocumentStorageService {
	private readonly root: string;

	constructor(@Inject(DOCUMENT_STORAGE_ROOT) root: string) {
		this.root = resolve(root);
	}

	newKey(): string {
		const id = randomUUID();
		return `${id.slice(0, 2)}/${id}`;
	}

	/** Atomic: bytes are fsynced in a temp file, then renamed into place. */
	async write(key: string, content: Buffer): Promise<void> {
		const target = this.pathFor(key);
		const temp = `${target}.${randomUUID()}.tmp`;

		await mkdir(dirname(target), { recursive: true });
		const handle = await open(temp, "wx", 0o600);

		try {
			await handle.writeFile(content);
			await handle.sync();
		} catch (error) {
			await handle.close().catch(() => undefined);
			await unlink(temp).catch(() => undefined);
			throw error;
		}
		await handle.close();

		try {
			await rename(temp, target);
		} catch (error) {
			await unlink(temp).catch(() => undefined);
			throw error;
		}
	}

	/** Missing file is success: deletion must be idempotent. */
	async delete(key: string): Promise<void> {
		try {
			await unlink(this.pathFor(key));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}

	/** Throws when the bytes are missing or unreadable. Returns the size. */
	async size(key: string): Promise<number> {
		return (await stat(this.pathFor(key))).size;
	}

	/** Keys of stored files last modified before the cutoff (for the orphan sweep). */
	async listKeysOlderThan(cutoffMs: number): Promise<string[]> {
		const keys: string[] = [];
		let shards: string[];
		try {
			shards = await readdir(this.root);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return keys;
			throw error;
		}

		for (const shard of shards) {
			if (!/^[0-9a-f]{2}$/.test(shard)) continue;
			for (const name of await readdir(join(this.root, shard))) {
				const key = `${shard}/${name}`;
				const isTemp = name.endsWith(".tmp");
				if (!isTemp && !KEY_PATTERN.test(key)) continue;
				const info = await stat(join(this.root, key)).catch(() => null);
				if (!info?.isFile() || info.mtimeMs >= cutoffMs) continue;
				if (isTemp) {
					await unlink(join(this.root, key)).catch(() => undefined);
				} else {
					keys.push(key);
				}
			}
		}
		return keys;
	}

	read(key: string): ReadStream {
		return createReadStream(this.pathFor(key));
	}

	private pathFor(key: string): string {
		if (!KEY_PATTERN.test(key)) {
			throw new Error("Invalid storage key.");
		}
		const path = resolve(join(this.root, key));
		if (!path.startsWith(this.root + sep)) {
			throw new Error("Invalid storage key.");
		}
		return path;
	}
}

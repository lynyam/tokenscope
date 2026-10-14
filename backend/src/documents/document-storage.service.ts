import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createReadStream, type ReadStream } from "node:fs";
import {
	chmod,
	lstat,
	mkdir,
	open,
	readdir,
	rename,
	stat,
	unlink,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export const DOCUMENT_STORAGE_ROOT = Symbol("DOCUMENT_STORAGE_ROOT");

const KEY_PATTERN =
	/^[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INCOMING_DIRECTORY = ".incoming";
const TEMP_PATTERN = /^[0-9a-f-]{36}\.tmp$/;

/**
 * Stores opaque blobs under a private root. Keys are generated here only.
 *
 * Layout:  <root>/<2 hex>/<uuid>   final files (0600)
 *          <root>/.incoming/<uuid>.tmp   uploads being received (same volume)
 */
@Injectable()
export class DocumentStorageService {
	private readonly root: string;
	private exclusive: Promise<unknown> = Promise.resolve();

	constructor(@Inject(DOCUMENT_STORAGE_ROOT) root: string) {
		this.root = resolve(root);
	}

	newKey(): string {
		const id = randomUUID();
		return `${id.slice(0, 2)}/${id}`;
	}

	/**
	 * In-process critical section for the single-backend MVP. Upload finalization
	 * (final move + metadata commit) and the orphan sweep's check-and-delete both
	 * run inside it, so the sweep can never delete a file between its move and its
	 * commit. Never hold it during network upload or PDF parsing.
	 */
	runExclusive<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.exclusive.then(operation, operation);
		this.exclusive = run.catch(() => undefined);
		return run;
	}

	/** Private directory (0700) where uploads are received before validation. */
	async incomingDirectory(): Promise<string> {
		const directory = join(this.root, INCOMING_DIRECTORY);
		await mkdir(directory, { recursive: true, mode: 0o700 });
		return directory;
	}

	/** Moves a validated temporary upload to its final private location. */
	async adopt(temporaryPath: string, key: string): Promise<void> {
		const incoming = join(this.root, INCOMING_DIRECTORY) + sep;
		const source = resolve(temporaryPath);
		if (!source.startsWith(incoming)) {
			throw new Error("Invalid temporary path.");
		}

		const target = this.pathFor(key);
		const targetDirectory = dirname(target);
		await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
		await chmod(source, 0o600);

		// multer does not flush: make the bytes durable before the row is committed.
		const file = await open(source, "r");
		try {
			await file.sync();
		} finally {
			await file.close();
		}

		await rename(source, target);

		for (const directory of new Set([
			dirname(source),
			targetDirectory,
			this.root,
		])) {
			await this.syncDirectory(directory);
		}
	}

	/** Flushes a directory entry. Platforms that cannot open directories skip it. */
	private async syncDirectory(directory: string): Promise<void> {
		let handle;
		try {
			handle = await open(directory, "r");
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "EISDIR" || code === "EPERM" || code === "EINVAL") return;
			throw error;
		}
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	}

	/** Atomic: bytes are fsynced in a temp file, then renamed into place. */
	async write(key: string, content: Buffer): Promise<void> {
		const target = this.pathFor(key);
		const temp = `${target}.${randomUUID()}.tmp`;

		await mkdir(dirname(target), { recursive: true, mode: 0o700 });
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

	async removeTemporary(temporaryPath: string): Promise<void> {
		const incoming = join(this.root, INCOMING_DIRECTORY) + sep;
		const target = resolve(temporaryPath);
		if (!target.startsWith(incoming)) return;
		await unlink(target).catch(() => undefined);
	}

	/** Throws when the bytes are missing or unreadable. Returns the size. */
	async size(key: string): Promise<number> {
		return (await stat(this.pathFor(key))).size;
	}

	read(key: string): ReadStream {
		return createReadStream(this.pathFor(key));
	}

	/**
	 * Managed final files last modified before the cutoff. Anything that does not
	 * match the server naming pattern, and every symbolic link, is ignored.
	 */
	async listKeysOlderThan(cutoffMs: number): Promise<string[]> {
		const keys: string[] = [];

		for (const shard of await this.listDirectory(this.root)) {
			if (!/^[0-9a-f]{2}$/.test(shard)) continue;

			for (const name of await this.listDirectory(join(this.root, shard))) {
				const key = `${shard}/${name}`;
				if (!KEY_PATTERN.test(key)) continue;

				const info = await lstat(join(this.root, key)).catch(() => null);
				if (info?.isFile() && info.mtimeMs < cutoffMs) keys.push(key);
			}
		}
		return keys;
	}

	/** Removes abandoned uploads (crash during reception) older than the cutoff. */
	async removeStaleTemporaryFiles(cutoffMs: number): Promise<number> {
		const directory = join(this.root, INCOMING_DIRECTORY);
		let removed = 0;

		for (const name of await this.listDirectory(directory)) {
			if (!TEMP_PATTERN.test(name)) continue;

			const path = join(directory, name);
			const info = await lstat(path).catch(() => null);
			if (info?.isFile() && info.mtimeMs < cutoffMs) {
				await unlink(path).catch(() => undefined);
				removed += 1;
			}
		}
		return removed;
	}

	private async listDirectory(directory: string): Promise<string[]> {
		try {
			return await readdir(directory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
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

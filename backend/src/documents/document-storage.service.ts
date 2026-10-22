import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { constants, type ReadStream } from "node:fs";
import {
	chmod,
	lstat,
	mkdir,
	open,
	opendir,
	rename,
	unlink,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export const DOCUMENT_STORAGE_ROOT = Symbol("DOCUMENT_STORAGE_ROOT");

const KEY_PATTERN =
	/^[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SWEEP_SCAN_BATCH_SIZE = 256;
const INCOMING_DIRECTORY = ".incoming";
const TEMP_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;

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
	private readonly activeTemporary = new Set<string>();
	private finalScan: AsyncGenerator<string> | null = null;
	private temporaryScan: AsyncGenerator<string> | null = null;

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
		await this.ensurePrivateDirectory(this.root);
		await this.ensurePrivateDirectory(directory);
		return directory;
	}

	/** Keep active reception/validation out of the age-based orphan sweep. */
	protectTemporary(path: string): () => void {
		const absolute = resolve(path);
		this.activeTemporary.add(absolute);
		return () => { this.activeTemporary.delete(absolute); };
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
		await this.ensurePrivateDirectory(this.root);
		await this.ensurePrivateDirectory(targetDirectory);
		await this.assertDirectory(dirname(source));
		if (!(await lstat(source)).isFile()) throw new Error("Invalid temporary file.");
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

		await this.ensurePrivateDirectory(this.root);
		await this.ensurePrivateDirectory(dirname(target));
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
			const path = this.pathFor(key);
			await this.assertDirectory(this.root);
			await this.assertDirectory(dirname(path));
			await unlink(path);
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

	/** Open the exact descriptor that will be streamed, before sending headers. */
	async read(key: string, expectedSize?: number): Promise<ReadStream> {
		const path = this.pathFor(key);
		await this.assertDirectory(this.root);
		await this.assertDirectory(dirname(path));
		const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const info = await handle.stat();
			if (!info.isFile() || (expectedSize !== undefined && info.size !== expectedSize)) {
				throw new Error("Stored document is unavailable.");
			}
			return handle.createReadStream({ autoClose: true });
		} catch (error) {
			await handle.close().catch(() => undefined);
			throw error;
		}
	}

	/** A bounded, resumable scan; referenced files cannot starve later orphans. */
	async listKeysOlderThan(cutoffMs: number): Promise<string[]> {
		this.finalScan ??= this.finalEntries();
		const keys: string[] = [];
		try {
			for (let i = 0; i < SWEEP_SCAN_BATCH_SIZE; i += 1) {
				const entry = await this.finalScan.next();
				if (entry.done) { this.finalScan = null; break; }
				const key = entry.value;
				if (!KEY_PATTERN.test(key)) continue;
				const info = await lstat(join(this.root, key)).catch(() => null);
				if (info?.isFile() && info.mtimeMs < cutoffMs) keys.push(key);
			}
		} catch (error) {
			await this.finalScan?.return(undefined);
			this.finalScan = null;
			throw error;
		}
		return keys;
	}

	async removeStaleTemporaryFiles(cutoffMs: number): Promise<number> {
		const directory = join(this.root, INCOMING_DIRECTORY);
		this.temporaryScan ??= this.listDirectory(directory);
		let removed = 0;
		try {
			for (let i = 0; i < SWEEP_SCAN_BATCH_SIZE; i += 1) {
				const entry = await this.temporaryScan.next();
				if (entry.done) { this.temporaryScan = null; break; }
				if (!TEMP_PATTERN.test(entry.value)) continue;
				const path = join(directory, entry.value);
				if (this.activeTemporary.has(path)) continue;
				const info = await lstat(path).catch(() => null);
				if (info?.isFile() && info.mtimeMs < cutoffMs) {
					await unlink(path);
					removed += 1;
				}
			}
		} catch (error) {
			await this.temporaryScan?.return(undefined);
			this.temporaryScan = null;
			throw error;
		}
		return removed;
	}

	async closeScans(): Promise<void> {
		await Promise.allSettled([
			this.finalScan?.return(undefined), this.temporaryScan?.return(undefined),
		]);
		this.finalScan = null;
		this.temporaryScan = null;
	}

	private async *finalEntries(): AsyncGenerator<string> {
		for await (const shard of this.listDirectory(this.root)) {
			// Count unknown entries too, so each scan is bounded.
			yield "";
			if (!/^[0-9a-f]{2}$/.test(shard)) continue;
			for await (const name of this.listDirectory(join(this.root, shard))) {
				yield `${shard}/${name}`;
			}
		}
	}

	private async *listDirectory(directory: string): AsyncGenerator<string> {
		const info = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return null;
			throw error;
		});
		if (!info?.isDirectory()) return; // includes symlinks
		const handle = await opendir(directory);
		for await (const entry of handle) yield entry.name;
	}

	private async assertDirectory(directory: string): Promise<void> {
		if (!(await lstat(directory)).isDirectory()) throw new Error("Invalid storage directory.");
	}

	private async ensurePrivateDirectory(directory: string): Promise<void> {
		await mkdir(directory, { recursive: true, mode: 0o700 });
		await this.assertDirectory(directory);
		await chmod(directory, 0o700);
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

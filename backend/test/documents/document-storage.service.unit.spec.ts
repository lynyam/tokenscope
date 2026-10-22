import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentStorageService, SWEEP_SCAN_BATCH_SIZE } from "../../src/documents/document-storage.service";

// The real module object, so a spy sees the calls made by the service.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fsPromises: typeof import("node:fs/promises") = require("node:fs/promises");

describe("DocumentStorageService", () => {
	let root: string;
	let storage: DocumentStorageService;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "tokenscope-docs-"));
		storage = new DocumentStorageService(root);
	});
	afterEach(async () => {
		await storage.closeScans();
		await rm(root, { recursive: true, force: true });
	});

	async function read(key: string) {
		const chunks: Buffer[] = [];
		for await (const chunk of await storage.read(key)) chunks.push(chunk as Buffer);
		return Buffer.concat(chunks);
	}

	it("round-trips bytes and leaves no temp file", async () => {
		const key = storage.newKey();
		await storage.write(key, Buffer.from("abc"));

		expect((await read(key)).toString()).toBe("abc");
		expect((await stat(join(root, key))).mode & 0o777).toBe(0o600);
		const names = await readdir(join(root, key.slice(0, 2)));
		expect(names).toEqual([key.slice(3)]);
	});

	it("deletes, and deleting twice is not an error", async () => {
		const key = storage.newKey();
		await storage.write(key, Buffer.from("abc"));

		await storage.delete(key);
		await expect(storage.delete(key)).resolves.toBeUndefined();
		await expect(readFile(join(root, key))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it.each(["../x", "/etc/passwd", "ab/../../x", "ab/not-a-uuid", ""])(
		"refuses key %j",
		async (key) => {
			await expect(storage.write(key, Buffer.from("x"))).rejects.toThrow(
				"Invalid storage key.",
			);
			await expect(storage.delete(key)).rejects.toThrow("Invalid storage key.");
		},
	);

	describe("private layout", () => {
		it("creates directories 0700 and final files 0600", async () => {
			const key = storage.newKey();
			await storage.write(key, Buffer.from("abc"));
			const incoming = await storage.incomingDirectory();

			expect((await stat(incoming)).mode & 0o777).toBe(0o700);
			expect((await stat(join(root, key.slice(0, 2)))).mode & 0o777).toBe(0o700);
			expect((await stat(join(root, key))).mode & 0o777).toBe(0o600);
		});

		it("moves a validated temporary upload into place", async () => {
			const incoming = await storage.incomingDirectory();
			const temporary = join(incoming, "11111111-1111-4111-8111-111111111111.tmp");
			await writeFile(temporary, "payload", { mode: 0o644 });

			const key = storage.newKey();
			await storage.adopt(temporary, key);

			expect((await read(key)).toString()).toBe("payload");
			expect((await stat(join(root, key))).mode & 0o777).toBe(0o600);
			await expect(stat(temporary)).rejects.toMatchObject({ code: "ENOENT" });
		});

		it("flushes the file and its directories around the rename", async () => {
			const incoming = await storage.incomingDirectory();
			const temporary = join(incoming, "22222222-2222-4222-8222-222222222222.tmp");
			await writeFile(temporary, "payload");
			const key = storage.newKey();
			const opened: string[] = [];
			const original = fsPromises.open;
			const spy = jest.spyOn(fsPromises, "open").mockImplementation(((path: string, ...rest: unknown[]) => {
				opened.push(String(path));
				return (original as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
			}) as never);
			try {
				await storage.adopt(temporary, key);
			} finally {
				spy.mockRestore();
			}

			expect(opened[0]).toBe(temporary);
			expect(opened).toEqual(
				expect.arrayContaining([incoming, join(root, key.slice(0, 2)), root]),
			);
		});

		it("refuses to adopt or remove a path outside the incoming directory", async () => {
			const outside = join(root, "outside.tmp");
			await writeFile(outside, "x");

			await expect(storage.adopt(outside, storage.newKey())).rejects.toThrow();
			await storage.removeTemporary(outside);
			expect((await stat(outside)).isFile()).toBe(true);
		});
	});

	describe("sweep helpers", () => {
		const old = new Date(Date.now() - 2 * 3_600_000);

		it("lists only managed, old, regular files and ignores symbolic links", async () => {
			const oldKey = storage.newKey();
			const youngKey = storage.newKey();
			const linkedKey = storage.newKey();
			await storage.write(oldKey, Buffer.from("o"));
			await storage.write(youngKey, Buffer.from("y"));
			await utimes(join(root, oldKey), old, old);

			await writeFile(join(root, "target.txt"), "t");
			await mkdir(join(root, linkedKey.slice(0, 2)), { recursive: true });
			await symlink(join(root, "target.txt"), join(root, linkedKey));

			await mkdir(join(root, "zz"), { recursive: true });
			await writeFile(join(root, "zz", "stray.txt"), "s");
			await writeFile(join(root, "stray"), "s");

			const keys = await storage.listKeysOlderThan(Date.now() - 3_600_000);

			expect(keys).toEqual([oldKey]);
		});

		it("returns nothing for a storage root that does not exist yet", async () => {
			const empty = new DocumentStorageService(join(root, "does-not-exist"));
			expect(await empty.listKeysOlderThan(Date.now())).toEqual([]);
		});

		it("removes only stale temporary uploads", async () => {
			const incoming = await storage.incomingDirectory();
			const stale = join(incoming, "22222222-2222-4222-8222-222222222222.tmp");
			const fresh = join(incoming, "33333333-3333-4333-8333-333333333333.tmp");
			const unrelated = join(incoming, "notes.txt");
			await Promise.all([writeFile(stale, "a"), writeFile(fresh, "b"), writeFile(unrelated, "c")]);
			await utimes(stale, old, old);
			await utimes(unrelated, old, old);

			expect(await storage.removeStaleTemporaryFiles(Date.now() - 3_600_000)).toBe(1);
			expect((await readdir(incoming)).sort()).toEqual(
				["33333333-3333-4333-8333-333333333333.tmp", "notes.txt"],
			);
		});
	});

	it("never follows a symlinked shard during orphan discovery", async () => {
		const outside = await mkdtemp(join(tmpdir(), "tokenscope-docs-outside-"));
		try {
			const name = "11111111-1111-4111-8111-111111111111";
			const target = join(outside, name);
			await writeFile(target, "outside");
			const old = new Date(Date.now() - 2 * 3_600_000);
			await utimes(target, old, old);
			await symlink(outside, join(root, "aa"));
			expect(await storage.listKeysOlderThan(Date.now())).toEqual([]);
			expect(await readFile(target, "utf8")).toBe("outside");
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	it("keeps an active temporary file even when its timestamp is old", async () => {
		const directory = await storage.incomingDirectory();
		const path = join(directory, "11111111-1111-4111-8111-111111111111.tmp");
		await writeFile(path, "upload");
		const old = new Date(Date.now() - 2 * 3_600_000);
		await utimes(path, old, old);
		const release = storage.protectTemporary(path);
		expect(await storage.removeStaleTemporaryFiles(Date.now())).toBe(0);
		release();
		expect(await storage.removeStaleTemporaryFiles(Date.now())).toBe(1);
	});

	it("bounds scan batches and eventually visits files after the first batch", async () => {
		await mkdir(join(root, "aa"));
		const total = SWEEP_SCAN_BATCH_SIZE + 3;
		for (let i = 0; i < total; i += 1) {
			const name = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
			await writeFile(join(root, "aa", name), "x");
		}
		const seen = new Set<string>();
		for (let i = 0; i < 3; i += 1) {
			const batch = await storage.listKeysOlderThan(Date.now() + 1000);
			expect(batch.length).toBeLessThanOrEqual(SWEEP_SCAN_BATCH_SIZE);
			batch.forEach((key) => seen.add(key));
		}
		expect(seen.size).toBe(total);
	});

	it("rejects wrong size and symbolic-link downloads before returning a stream", async () => {
		const key = storage.newKey();
		await storage.write(key, Buffer.from("abc"));
		await expect(storage.read(key, 4)).rejects.toThrow();
		await rm(join(root, key));
		await writeFile(join(root, "outside.txt"), "abc");
		await symlink(join(root, "outside.txt"), join(root, key));
		await expect(storage.read(key, 3)).rejects.toThrow();
	});

	describe("runExclusive", () => {
		it("runs operations one at a time, in order", async () => {
			const events: string[] = [];
			const slow = storage.runExclusive(async () => {
				events.push("a:start");
				await new Promise((resolve) => setTimeout(resolve, 30));
				events.push("a:end");
			});
			const fast = storage.runExclusive(async () => { events.push("b"); });

			await Promise.all([slow, fast]);

			expect(events).toEqual(["a:start", "a:end", "b"]);
		});

		it("keeps working after an operation fails", async () => {
			await expect(storage.runExclusive(async () => { throw new Error("x"); })).rejects.toThrow("x");
			await expect(storage.runExclusive(async () => 42)).resolves.toBe(42);
		});
	});
});

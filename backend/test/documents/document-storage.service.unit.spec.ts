import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentStorageService } from "../../src/documents/document-storage.service";

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
	afterEach(() => rm(root, { recursive: true, force: true }));

	async function read(key: string) {
		const chunks: Buffer[] = [];
		for await (const chunk of storage.read(key)) chunks.push(chunk as Buffer);
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

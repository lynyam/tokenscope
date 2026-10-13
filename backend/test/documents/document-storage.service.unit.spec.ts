import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentStorageService } from "../../src/documents/document-storage.service";

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
});

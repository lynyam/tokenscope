import {
	generateApiKeySecret,
	hashApiKey,
	hasValidApiKeyFormat,
} from "../../src/api-keys/api-key-secret";

describe("API-key secret contract", () => {
	it("generates 32 bytes with a matching digest and prefix", () => {
		const secret = generateApiKeySecret();

		expect(secret.key).toMatch(/^tsk_[A-Za-z0-9_-]{43}$/);
		expect(
			Buffer.from(secret.key.slice(4), "base64url"),
		).toHaveLength(32);
		expect(secret.keyPrefix).toBe(secret.key.slice(0, 12));
		expect(secret.keyHash).toBe(hashApiKey(secret.key));
		expect(secret.keyHash).toMatch(/^[a-f0-9]{64}$/);
		expect(hasValidApiKeyFormat(secret.key)).toBe(true);
	});

	it.each([
		"",
		"Bearer something",
		"tsk_short",
		`tsk_${"a".repeat(44)}`,
		`tsk_${"a".repeat(42)}!`,
	])("rejects malformed value %j", value => {
		expect(hasValidApiKeyFormat(value)).toBe(false);
	});

	it("does not trim or accept combined values", () => {
		const { key } = generateApiKeySecret();

		expect(hasValidApiKeyFormat(` ${key}`)).toBe(false);
		expect(hasValidApiKeyFormat(`${key} `)).toBe(false);
		expect(hasValidApiKeyFormat(`${key}, ${key}`)).toBe(false);
	});
});

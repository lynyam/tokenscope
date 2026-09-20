/**
 * Suite:  npm run test:unit   (config: test/jest-unit.json)
 * Scope:  pure function, no NestJS container, no database, no HTTP.
 * Proves: SECURITY.md "Safe user output" — passwordHash never escapes.
 */
import { toSafeUser } from "../../src/users/user.mapper";

describe("toSafeUser", () => {
  it("keeps only id, email and displayName", () => {
    const rawUser = {
      id: "user-1",
      email: "alice@example.com",
      displayName: "Alice",
      passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$abc",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never;

    expect(toSafeUser(rawUser)).toEqual({
      id: "user-1",
      email: "alice@example.com",
      displayName: "Alice",
    });
  });

  it("never includes passwordHash in the output", () => {
    const rawUser = {
      id: "user-1",
      email: "alice@example.com",
      displayName: "Alice",
      passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$abc",
    } as never;

    const result = toSafeUser(rawUser);

    expect(result).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(result)).not.toContain("argon2id");
  });
});
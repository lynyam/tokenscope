/**
 * Suite:  npm run test:unit   (config: test/jest-unit.json)
 * Scope:  pure function, no NestJS container, no database, no HTTP.
 * Proves: SECURITY.md "Safe user output" — passwordHash never escapes.
 */
import { toSafeUser } from "../../src/users/user.mapper";


/**
 * describe: Groups related tests together into a test suite. 
 *           It helps organize test output in logs and creates 
 *           a shared block scope for set-up or tear-down logic.
 */

describe("toSafeUser", () => {
  /**
   * it: (Alias for test) Defines an individual test case. 
   *     It accepts a descriptive string detailing what behavior 
   *     is being tested and an executable function containing the test logic
   */
  it("keeps only id, email and displayName", () => {
    const rawUser = {
      id: "user-1",
      email: "alice@example.com",
      displayName: "Alice",
      passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$abc",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never;
    /**
     * expect: Used every time you want to test a value. 
     *         You call expect with the actual value returned 
     *         by your code and pair it with a matcher (like .toEqual()) 
     *         to assert whether it meets your expectations.
     */
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
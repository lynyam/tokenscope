/**
 * Global Vitest setup — runs once before any test file. Not a test
 * itself; configures the testing environment (jest-dom matchers,
 * per-test DOM/localStorage cleanup).
 */
import "@testing-library/jest-dom";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  localStorage.clear();
});
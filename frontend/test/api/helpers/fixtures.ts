/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Reads a shared backend fixture from <repo root>/fixtures/evaluation/assistant/.
export function readFixture(name: string): string {
  return readFileSync(resolve(here, '../../../../fixtures/evaluation/assistant', name), 'utf-8');
}
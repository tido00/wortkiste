// Lets `node --test tests/` work on every Node version: loads each *.test.js here.
import { readdirSync } from 'node:fs';
const dir = new URL('./', import.meta.url);
for (const f of readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort()) {
  await import(new URL(f, dir));
}

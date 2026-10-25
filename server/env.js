import { fileURLToPath } from 'node:url';

// Keys may sit in a .env file at the repo root (git ignores it) instead of an
// export in the server window; an exported value still wins over the file.
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  // no .env: the keys come from the environment
}

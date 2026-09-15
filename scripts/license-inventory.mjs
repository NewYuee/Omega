// Metadata inventory only: this is not a license compatibility approval.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const packages = Object.entries(lock.packages).filter(([location]) => location).map(([location, value]) => ({
  location,
  name: value.name || location.split('node_modules/').at(-1),
  version: value.version || null,
  license: value.license || null,
  development: Boolean(value.dev),
  optional: Boolean(value.optional),
  resolved: value.resolved || null,
  integrity: value.integrity || null,
})).sort((a, b) => a.location.localeCompare(b.location));
const missing = packages.filter(value => !value.license);
console.log(JSON.stringify({
  scope: 'All npm lockfile entries, including build tools and optional platforms; not an artifact SBOM.',
  limitations: 'Metadata is not verified license text. Native transitive libraries, Cargo, Gradle, Electron/Chromium, copied source and assets require separate review. OR and AND expressions must be reviewed as written.',
  counts: { total: packages.length, missingLicense: missing.length },
  packages,
}, null, 2));
if (process.argv.includes('--strict') && missing.length) process.exitCode = 1;

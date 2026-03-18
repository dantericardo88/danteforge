import { readFile } from 'node:fs/promises';

const file = 'THIRD_PARTY_NOTICES.md';

try {
  const content = await readFile(file, 'utf8');
  if (/\bTODO\b/.test(content)) {
    console.error(`${file} still contains TODO placeholders. Fill provenance/license details before release.`);
    process.exit(1);
  }
  console.log(`${file} looks complete (no TODO markers found).`);
} catch (error) {
  console.error(`Failed to read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

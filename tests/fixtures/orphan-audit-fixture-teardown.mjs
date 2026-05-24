#!/usr/bin/env node
// orphan-audit-fixture-teardown.mjs — clean up the orphan-audit fixture.

import fs from 'node:fs/promises';
import path from 'node:path';

const FIXTURE_DIR = path.join(process.cwd(), '.danteforge', 'capability-tests', 'fixtures', 'orphan-audit');
try { await fs.rm(FIXTURE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
process.stdout.write(`PASS: fixture removed from ${FIXTURE_DIR}\n`);

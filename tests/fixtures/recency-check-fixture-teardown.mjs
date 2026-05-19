#!/usr/bin/env node
// recency-check-fixture-teardown.mjs — clean up the recency-check fixture.

import fs from 'node:fs/promises';
import path from 'node:path';

const FIXTURE_DIR = path.join(process.cwd(), '.danteforge', 'capability-tests', 'fixtures', 'recency-check');
try { await fs.rm(FIXTURE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
process.stdout.write(`PASS: fixture removed from ${FIXTURE_DIR}\n`);

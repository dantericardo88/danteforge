// ratify — the operator's surface to vouch for a subjective harvested bar (capability/demand), the
// human-ratify half of "human-ratifies + machine-climbs". Lists the subjective bars awaiting ratification
// for a dimension; ratifying one signs it (CH-030) into the kernel-owned ratified-signals store so
// checkHarvestProvenance accepts it. Benchmarks never appear here — they auto-accept on verified_live.
//
//   danteforge ratify --dim code_generation                          # list candidates
//   danteforge ratify --dim code_generation --index 0 --as richard   # vouch for candidate 0

import { loadHarvestedSignals } from '../../core/harvest-loader.js';
import { isRatificationCandidate, ratifySignal, saveRatifiedSignal } from '../../core/ratified-signals.js';

export async function ratifyCommand(opts: { dim?: string; index?: string; as?: string; cwd?: string } = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  if (!opts.dim) {
    console.error('[ratify] --dim <id> is required (the dimension whose subjective bar you are vouching for).');
    process.exitCode = 1;
    return;
  }
  const signals = await loadHarvestedSignals(cwd, opts.dim);
  const candidates = signals.filter(isRatificationCandidate);

  // LIST mode: no index/operator → show the subjective bars awaiting ratification.
  if (opts.index === undefined || !opts.as) {
    console.error(`[ratify] subjective bars awaiting ratification for "${opts.dim}":`);
    if (candidates.length === 0) {
      console.error('  (none — no capability/demand signal needs vouching; benchmarks auto-accept on verified_live)');
    } else {
      candidates.forEach((s, i) => console.error(`  [${i}] (${s.kind}) ${s.claim}  —  ${s.source}`));
      console.error(`\n  To vouch: danteforge ratify --dim ${opts.dim} --index <n> --as <your-id>`);
      console.error('  (Ratification is signed + recorded. Only ratify a bar you have actually verified is honest.)');
    }
    return;
  }

  // RATIFY mode: sign + persist the chosen candidate.
  const idx = Number(opts.index);
  const target = Number.isInteger(idx) ? candidates[idx] : undefined;
  if (!target) {
    console.error(`[ratify] no candidate at index ${opts.index} (run without --index/--as to list ${candidates.length} candidate(s)).`);
    process.exitCode = 1;
    return;
  }
  const ratified = ratifySignal(target, opts.as);
  const path = await saveRatifiedSignal(cwd, ratified);
  console.error(`[ratify] ✓ ${opts.as} vouched for (${ratified.kind}) "${ratified.claim}" — signed + recorded → ${path}`);
  console.error('[ratify] this bar now clears checkHarvestProvenance for the grounding gate (ratified_by + valid signature).');
}

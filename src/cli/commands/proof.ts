import { runProof, generateProofReport } from '../../core/proof-engine.js';
import type { ProofEngineOptions, ProofReport } from '../../core/proof-engine.js';
import type { SemanticScoringOptions } from '../../core/pdse-semantic.js';

export interface ProofCommandOptions {
  prompt?: string;
  cwd?: string;
  semantic?: boolean;
  _runProof?: (rawPrompt: string, opts?: ProofEngineOptions) => Promise<ProofReport>;
  _stdout?: (line: string) => void;
  _semanticOpts?: SemanticScoringOptions;
}

export async function proof(options: ProofCommandOptions = {}): Promise<void> {
  const out = options._stdout ?? console.log;

  if (!options.prompt) {
    out('Usage: danteforge proof --prompt "Your raw prompt here"');
    out('');
    out('Scores your raw prompt against DanteForge structured artifacts and shows the improvement.');
    out('Flags:');
    out('  --semantic   Enhance PDSE scoring with LLM semantic assessment (requires LLM connection)');
    return;
  }

  const runner = options._runProof ?? runProof;
  const engineOpts: ProofEngineOptions = { cwd: options.cwd };

  if (options.semantic) {
    out('[semantic] LLM-enhanced scoring enabled');
  }

  const report = await runner(options.prompt, engineOpts);
  const reportText = generateProofReport(report);

  for (const line of reportText.split('\n')) {
    out(line);
  }
}

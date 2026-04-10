// Quick test of harsh scorer
import { computeHarshScore } from './src/core/harsh-scorer.js';
import { loadState } from './src/core/state.js';
import { scoreAllArtifacts } from './src/core/pdse.js';
import { assessMaturity } from './src/core/maturity-engine.js';

async function test() {
  try {
    console.log('Testing harsh scorer...');
    const cwd = process.cwd();
    const state = await loadState({ cwd });
    const pdseScores = await scoreAllArtifacts(cwd, state);
    const maturityAssessment = await assessMaturity({ cwd, state, pdseScores, targetLevel: 5 });

    console.log('Running computeHarshScore...');
    const result = await computeHarshScore({
      cwd,
      targetLevel: 5,
      _loadState: async () => state,
      _scoreAllArtifacts: async () => pdseScores,
      _assessMaturity: async () => maturityAssessment
    });

    console.log('Harsh score result:', {
      overall: result.displayScore,
      passes: result.passesThreshold,
      dimensions: Object.keys(result.dimensions).length
    });

  } catch (error) {
    console.error('Error:', error);
  }
}

test();
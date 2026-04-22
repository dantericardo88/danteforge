// Quick test of maturity assessment
import { assessMaturity } from './src/core/maturity-engine.js';
import { loadState } from './src/core/state.js';
import { scoreAllArtifacts } from './src/core/pdse.js';

async function test() {
  try {
    console.log('Testing maturity assessment...');
    const cwd = process.cwd();
    const state = await loadState({ cwd });
    const pdseScores = await scoreAllArtifacts(cwd, state);

    console.log('Running assessMaturity...');
    const result = await assessMaturity({ cwd, state, pdseScores, targetLevel: 5 });

    console.log('Maturity assessment completed:');
    console.log(JSON.stringify(result.dimensions, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
import express from 'express';
import { loadState } from '../core/state.js';
import { scoreAllArtifacts } from '../core/pdse.js';

export async function dashboard(options: { port?: number } = {}) {
  const app = express();
  const port = options.port || 3000;

  app.get('/', async (req, res) => {
    const state = await loadState({ cwd: process.cwd() });
    const scores = await scoreAllArtifacts({ cwd: process.cwd() });
    const avgScore = Object.values(scores).reduce((sum, s) => sum + s.score, 0) / Object.values(scores).length;

    res.send(`
      <html>
        <head><title>DanteForge Dashboard</title></head>
        <body>
          <h1>DanteForge Status</h1>
          <p>Project: ${state.projectType || 'Unknown'}</p>
          <p>Average Maturity Score: ${avgScore.toFixed(1)}/10</p>
          <h2>Artifact Scores</h2>
          <ul>
            ${Object.entries(scores).map(([k, v]) => `<li>${k}: ${v.score}/10</li>`).join('')}
          </ul>
        </body>
      </html>
    `);
  });

  app.listen(port, () => {
    console.log(`Dashboard running at http://localhost:${port}`);
  });
}
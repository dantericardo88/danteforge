const lines = [
  '[danteforge] Package install completed.',
  '[danteforge] Run `npx danteforge init` to set up your workspace and connect to your AI assistant.',
  '[danteforge] init will detect your editor and configure skills automatically.',
];

process.stdout.write(`${lines.join('\n')}\n`);

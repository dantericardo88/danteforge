const lines = [
  '[danteforge] Package install completed.',
  '[danteforge] Assistant setup is explicit for GA safety and trust.',
  '[danteforge] Run one of the following when you want to enable assistants:',
  '  npx danteforge setup assistants',
  '  npx danteforge setup assistants --assistants codex',
  '  npx danteforge setup assistants --assistants cursor',
];

process.stdout.write(`${lines.join('\n')}\n`);

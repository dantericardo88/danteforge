const fs = require('fs');
const path = require('path');

// Simple script to generate docs from code comments
const commandsDir = path.join(__dirname, '..', 'src', 'cli', 'commands');
const docs = [];

fs.readdirSync(commandsDir).forEach(file => {
  if (file.endsWith('.ts') && !file.includes('index')) {
    const content = fs.readFileSync(path.join(commandsDir, file), 'utf8');
    const lines = content.split('\n');
    lines.forEach(line => {
      if (line.trim().startsWith('//')) {
        docs.push(line.trim().substring(2).trim());
      }
    });
  }
});

fs.writeFileSync(path.join(__dirname, '..', 'docs', 'generated-docs.md'), docs.join('\n'));
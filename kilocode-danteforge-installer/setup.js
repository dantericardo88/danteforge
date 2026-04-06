#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Setting up DanteForge integration for Kilocode...');

// Check if DanteForge is installed
try {
  execSync('danteforge --version', { stdio: 'pipe' });
  console.log('✅ DanteForge CLI is available');
} catch (error) {
  console.log('❌ DanteForge CLI not found. Installing...');
  try {
    execSync('npm install -g danteforge', { stdio: 'inherit' });
    console.log('✅ DanteForge CLI installed');
  } catch (installError) {
    console.log('❌ Failed to install DanteForge CLI:', installError.message);
    process.exit(1);
  }
}

// Create skill directories
const homeDir = process.env.HOME || process.env.USERPROFILE;
const skillDirs = [
  path.join(homeDir, '.kilo', 'skills'),
  path.join(homeDir, '.config', 'kilo', 'skills'),
  path.join(homeDir, '.claude', 'skills'),
  path.join(homeDir, '.codex', 'skills')
];

let skillDirCreated = false;
for (const skillDir of skillDirs) {
  try {
    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
      console.log(`📁 Created skill directory: ${skillDir}`);
    }

    // Copy the DanteForge integration skill
    const skillPath = path.join(skillDir, 'danteforge-integration');
    if (!fs.existsSync(skillPath)) {
      fs.mkdirSync(skillPath, { recursive: true });
    }

    const skillFile = path.join(skillPath, 'SKILL.md');
    const sourceSkill = path.join(__dirname, '..', 'kilocode-danteforge-skill.md');

    if (fs.existsSync(sourceSkill)) {
      fs.copyFileSync(sourceSkill, skillFile);
      console.log(`✅ Installed DanteForge integration skill in: ${skillDir}`);
      skillDirCreated = true;
    }
  } catch (error) {
    console.log(`⚠️  Could not create skill directory: ${skillDir} - ${error.message}`);
  }
}

if (skillDirCreated) {
  console.log('\n🎉 DanteForge integration setup complete!');
  console.log('\nTo use DanteForge in Kilocode:');
  console.log('1. Load the "danteforge-integration" skill when needed');
  console.log('2. Use DanteForge commands via the bash tool, e.g., bash("danteforge magic \\"build a todo app\\"")');
  console.log('3. Combine DanteForge planning with Kilocode\'s implementation tools');
} else {
  console.log('\n⚠️  Skill installation completed, but no skill directories were accessible.');
  console.log('You can still use DanteForge by calling it directly via bash commands.');
}

console.log('\n📚 Useful DanteForge commands:');
console.log('- danteforge magic "<goal>" - Balanced development workflow');
console.log('- danteforge autoforge "<goal>" - Autonomous pipeline execution');
console.log('- danteforge verify - Quality checks and verification');
console.log('- danteforge help - See all available commands');
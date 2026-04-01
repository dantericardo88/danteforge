#!/usr/bin/env node

// Kilocode + DanteForge Integration
// This is mainly a setup package, but provides some utility functions

const { execSync } = require('child_process');

function runDanteForgeCommand(command, options = {}) {
  try {
    const result = execSync(`danteforge ${command}`, {
      encoding: 'utf8',
      ...options
    });
    return result;
  } catch (error) {
    throw new Error(`DanteForge command failed: ${error.message}`);
  }
}

function checkDanteForgeInstallation() {
  try {
    const version = execSync('danteforge --version', { encoding: 'utf8' });
    return version.trim();
  } catch (error) {
    return null;
  }
}

module.exports = {
  runDanteForgeCommand,
  checkDanteForgeInstallation
};

// If run directly, show help
if (require.main === module) {
  console.log('Kilocode + DanteForge Integration');
  console.log('=============================== ');
  console.log('');
  console.log('This package integrates DanteForge with Kilocode.');
  console.log('Run setup with: kilocode-danteforge-setup');
  console.log('');
  console.log('API:');
  console.log('- checkDanteForgeInstallation() - Check if DanteForge is installed');
  console.log('- runDanteForgeCommand(cmd) - Execute DanteForge commands');
}
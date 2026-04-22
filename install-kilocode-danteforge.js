#!/usr/bin/env node

/**
 * Kilocode + DanteForge Installation Script
 *
 * This script builds and installs the DanteForge integration for Kilocode.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔧 Building Kilocode + DanteForge Integration...\n');

// Build DanteForge first
console.log('📦 Building DanteForge CLI...');
try {
  execSync('npm run build', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  console.log('✅ DanteForge CLI built successfully\n');
} catch (error) {
  console.error('❌ Failed to build DanteForge:', error.message);
  process.exit(1);
}

// Install the integration package
console.log('📦 Installing Kilocode + DanteForge integration...');
try {
  execSync('cd kilocode-danteforge-installer && npm install', { stdio: 'inherit' });
  console.log('✅ Dependencies installed\n');
} catch (error) {
  console.error('❌ Failed to install dependencies:', error.message);
  process.exit(1);
}

// Run the setup
console.log('🚀 Running setup...');
try {
  execSync('node setup.js', { stdio: 'inherit', cwd: path.join(__dirname, 'kilocode-danteforge-installer') });
} catch (error) {
  console.error('❌ Setup failed:', error.message);
  process.exit(1);
}

console.log('\n🎉 Installation complete!');
console.log('\n📖 Next steps:');
console.log('1. Restart Kilocode to load the new skills');
console.log('2. Use the "danteforge-integration" skill for DanteForge workflows');
console.log('3. Try: bash("danteforge magic \\"create a hello world app\\"")');
console.log('\n📚 Documentation: See kilocode-danteforge-installer/README.md');
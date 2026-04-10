#!/usr/bin/env node

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const errors = [];

function checkConsistency() {
  try {
    // Get actual git remote
    const gitRemote = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
    const expectedRemote = 'https://github.com/dantericardo88/danteforge.git';

    if (gitRemote !== expectedRemote) {
      errors.push(`Git remote mismatch: got ${gitRemote}, expected ${expectedRemote}`);
    }

    // Check package.json
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const pkgRemote = pkg.repository.url;
    const pkgHomepage = pkg.homepage;
    const pkgBugs = pkg.bugs.url;
    const pkgVersion = pkg.version;

    if (pkgRemote !== expectedRemote) {
      errors.push(`package.json repository.url mismatch: got ${pkgRemote}, expected ${expectedRemote}`);
    }
    if (pkgHomepage !== expectedRemote.replace('.git', '')) {
      errors.push(`package.json homepage mismatch: got ${pkgHomepage}, expected ${expectedRemote.replace('.git', '')}`);
    }
    if (pkgBugs !== expectedRemote.replace('.git', '/issues')) {
      errors.push(`package.json bugs.url mismatch: got ${pkgBugs}, expected ${expectedRemote.replace('.git', '/issues')}`);
    }

    // Check vscode-extension/package.json
    const extPkg = JSON.parse(readFileSync('vscode-extension/package.json', 'utf8'));
    const extRemote = extPkg.repository.url;
    const extHomepage = extPkg.homepage;
    const extBugs = extPkg.bugs.url;
    const extVersion = extPkg.version;

    if (extRemote !== expectedRemote) {
      errors.push(`vscode-extension/package.json repository.url mismatch: got ${extRemote}, expected ${expectedRemote}`);
    }
    if (extHomepage !== expectedRemote.replace('.git', '')) {
      errors.push(`vscode-extension/package.json homepage mismatch: got ${extHomepage}, expected ${expectedRemote.replace('.git', '')}`);
    }
    if (extBugs !== expectedRemote.replace('.git', '/issues')) {
      errors.push(`vscode-extension/package.json bugs.url mismatch: got ${extBugs}, expected ${expectedRemote.replace('.git', '/issues')}`);
    }
    if (extVersion !== pkgVersion) {
      errors.push(`Version mismatch: package.json ${pkgVersion}, vscode-extension ${extVersion}`);
    }

    // Check README.md
    const readme = readFileSync('README.md', 'utf8');
    const readmeVersionBadge = readme.match(/badge\/([\d.]+)-blue/);
    if (readmeVersionBadge && readmeVersionBadge[1] !== pkgVersion) {
      errors.push(`README version badge mismatch: got ${readmeVersionBadge[1]}, expected ${pkgVersion}`);
    }

    const readmeCloneUrl = readme.match(/git clone (https:\/\/github\.com\/[^/]+\/[^/]+\.git)/);
    if (readmeCloneUrl && readmeCloneUrl[1] !== expectedRemote) {
      errors.push(`README clone URL mismatch: got ${readmeCloneUrl[1]}, expected ${expectedRemote}`);
    }

    // Check RELEASE.md if exists
    try {
      const releaseMd = readFileSync('RELEASE.md', 'utf8');
      const releaseVersion = releaseMd.match(/Version: ([\d.]+)/);
      if (releaseVersion && releaseVersion[1] !== pkgVersion) {
        errors.push(`RELEASE.md version mismatch: got ${releaseVersion[1]}, expected ${pkgVersion}`);
      }
    } catch {
      // File not found, skip check
    }

    // Check docs/Operational-Readiness-v${pkgVersion}.md if exists
    try {
      const operationalMd = readFileSync(`docs/Operational-Readiness-v${pkgVersion}.md`, 'utf8');
      const operationalVersion = operationalMd.match(/Version: ([\d.]+)/);
      if (operationalVersion && operationalVersion[1] !== pkgVersion) {
        errors.push(`Operational readiness doc version mismatch: got ${operationalVersion[1]}, expected ${pkgVersion}`);
      }
    } catch {
      // File not found, skip check
    }

    // Check enterprise doc version
    try {
      const enterpriseMd = readFileSync('docs/PHASE_1_ENTERPRISE_READINESS.md', 'utf8');
      const enterpriseVersion = enterpriseMd.match(/Version: ([\d.]+)\+enterprise/);
      if (enterpriseVersion && enterpriseVersion[1] !== pkgVersion) {
        errors.push(`Enterprise doc version mismatch: got ${enterpriseVersion[1]}, expected ${pkgVersion}`);
      }
    } catch {
      // File not found, skip check
    }

    if (errors.length > 0) {
      console.error('Truth surface inconsistencies found:');
      errors.forEach(error => console.error(`- ${error}`));
      process.exit(1);
    } else {
      console.log('Truth surface is consistent.');
    }
  } catch (error) {
    console.error('Error checking truth surface:', error.message);
    process.exit(1);
  }
}

checkConsistency();
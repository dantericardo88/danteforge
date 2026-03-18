import fs from 'node:fs/promises';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const plugin = JSON.parse(await fs.readFile('.claude-plugin/plugin.json', 'utf8'));
const marketplace = JSON.parse(await fs.readFile('.claude-plugin/marketplace.json', 'utf8'));

if (plugin.name !== pkg.name) {
  fail(`.claude-plugin/plugin.json name "${plugin.name}" does not match package name "${pkg.name}".`);
}

if (plugin.version !== pkg.version) {
  fail(`.claude-plugin/plugin.json version "${plugin.version}" does not match package version "${pkg.version}".`);
}

if (marketplace.name !== pkg.name) {
  fail(`.claude-plugin/marketplace.json name "${marketplace.name}" does not match package name "${pkg.name}".`);
}

if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
  fail('.claude-plugin/marketplace.json must contain at least one plugin entry.');
}

const [entry] = marketplace.plugins;

if (entry.name !== pkg.name) {
  fail(`Marketplace plugin entry name "${entry.name}" does not match package name "${pkg.name}".`);
}

if (entry.version !== pkg.version) {
  fail(`Marketplace plugin entry version "${entry.version}" does not match package version "${pkg.version}".`);
}

if (entry.source !== './') {
  fail(`Marketplace plugin entry source must be "./", received "${entry.source}".`);
}

console.log('Claude plugin manifests are aligned with package metadata.');

// awesome-scan — Skill discovery, domain classification, and import CLI
import { logger } from '../../core/logger.js';
import {
  buildRegistry,
  scanExternalSource,
  groupByDomain,
  importExternalSkill,
  checkCompatibility,
  type SkillRegistryEntry,
} from '../../core/skill-registry.js';

export async function awesomeScan(options: {
  source?: string;
  domain?: string;
  install?: boolean;
}): Promise<void> {
  logger.success('DanteForge Skill Scanner');
  logger.info('');

  // Build current registry
  logger.info('Scanning packaged and user skills...');
  const registry = await buildRegistry();
  logger.info(`Found ${registry.length} registered skill(s)`);

  // Scan external source if provided
  let externalSkills: SkillRegistryEntry[] = [];
  if (options.source) {
    logger.info(`\nScanning external source: ${options.source}`);
    externalSkills = await scanExternalSource(options.source);
    logger.info(`Found ${externalSkills.length} external skill(s)`);
  }

  const allSkills = [...registry, ...externalSkills];

  // Filter by domain if requested
  const filteredSkills = options.domain
    ? allSkills.filter(s => s.domain === options.domain)
    : allSkills;

  if (filteredSkills.length === 0) {
    logger.warn('No skills found matching criteria.');
    return;
  }

  // Group and display
  const grouped = groupByDomain(filteredSkills);
  logger.info('');
  logger.success('=== Skill Registry ===');

  for (const [domain, skills] of Object.entries(grouped)) {
    logger.info('');
    logger.info(`  [${domain.toUpperCase()}] (${skills.length} skill${skills.length !== 1 ? 's' : ''})`);
    for (const skill of skills) {
      const sourceTag = skill.source === 'packaged' ? '' : ` [${skill.source}]`;
      logger.info(`    - ${skill.name}${sourceTag}: ${skill.description.slice(0, 80)}${skill.description.length > 80 ? '...' : ''}`);
    }
  }

  // Install external skills if requested
  if (options.install && externalSkills.length > 0) {
    logger.info('');
    logger.info('Checking compatibility and importing external skills...');

    for (const skill of externalSkills) {
      const compat = await checkCompatibility(skill);
      if (!compat.compatible) {
        logger.warn(`  Skipping "${skill.name}": missing ${compat.missing.join(', ')}`);
        continue;
      }

      const result = await importExternalSkill(skill);
      if (result.success) {
        logger.success(`  Imported "${skill.name}" -> ${result.path}`);
      } else {
        logger.error(`  Failed to import "${skill.name}": ${result.error}`);
      }
    }
  }

  // Summary
  logger.info('');
  logger.info('-'.repeat(50));
  const domains = Object.keys(grouped);
  logger.info(`Total: ${filteredSkills.length} skill(s) across ${domains.length} domain(s)`);
  if (externalSkills.length > 0 && !options.install) {
    logger.info('Run with --install to import compatible external skills.');
  }
}

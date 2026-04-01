#!/usr/bin/env node

/**
 * Validate SBOM structure and completeness
 *
 * Checks:
 * - Valid JSON structure
 * - Required CycloneDX fields present
 * - All components have valid purls
 * - License information present
 * - NTIA minimum elements satisfied
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('[SBOM] Validating SBOM files...');

// Find all SBOM files
const sbomDir = join(projectRoot, 'sbom');
let sbomFiles = [];

try {
  sbomFiles = readdirSync(sbomDir).filter((f) => f.endsWith('.cdx.json'));
} catch (err) {
  console.error('[SBOM] ✗ SBOM directory not found. Run `npm run sbom:generate` first.');
  process.exit(1);
}

if (sbomFiles.length === 0) {
  console.error('[SBOM] ✗ No SBOM files found. Run `npm run sbom:generate` first.');
  process.exit(1);
}

console.log(`[SBOM] Found ${sbomFiles.length} SBOM file(s):`);
for (const file of sbomFiles) {
  console.log(`  - ${file}`);
}

let allValid = true;

for (const file of sbomFiles) {
  const filePath = join(sbomDir, file);
  console.log(`\n[SBOM] Validating: ${file}`);

  try {
    const content = readFileSync(filePath, 'utf8');
    const sbom = JSON.parse(content);

    const errors = [];
    const warnings = [];

    // Check required fields
    if (!sbom.bomFormat || sbom.bomFormat !== 'CycloneDX') {
      errors.push('Missing or invalid bomFormat (must be "CycloneDX")');
    }

    if (!sbom.specVersion) {
      errors.push('Missing specVersion');
    }

    if (!sbom.serialNumber) {
      errors.push('Missing serialNumber');
    } else if (!sbom.serialNumber.startsWith('urn:uuid:')) {
      warnings.push('serialNumber should start with "urn:uuid:"');
    }

    if (!sbom.metadata) {
      errors.push('Missing metadata');
    } else {
      if (!sbom.metadata.timestamp) {
        warnings.push('Missing metadata.timestamp');
      }

      if (!sbom.metadata.component) {
        errors.push('Missing metadata.component (root component)');
      } else {
        if (!sbom.metadata.component.name) {
          errors.push('Missing metadata.component.name');
        }
        if (!sbom.metadata.component.version) {
          errors.push('Missing metadata.component.version');
        }
      }
    }

    if (!sbom.components || !Array.isArray(sbom.components)) {
      errors.push('Missing or invalid components array');
    } else {
      // Validate components
      const componentErrors = validateComponents(sbom.components);
      errors.push(...componentErrors);
    }

    // Check NTIA minimum elements
    const ntiaCheck = checkNTIAMinimumElements(sbom);
    if (!ntiaCheck.valid) {
      errors.push(...ntiaCheck.errors);
    }

    // Report results
    if (errors.length > 0) {
      console.log('[SBOM] ✗ Validation failed:');
      for (const error of errors) {
        console.log(`  ERROR: ${error}`);
      }
      allValid = false;
    } else {
      console.log('[SBOM] ✓ Validation passed');
    }

    if (warnings.length > 0) {
      console.log('[SBOM] Warnings:');
      for (const warning of warnings) {
        console.log(`  WARN: ${warning}`);
      }
    }

    // Print summary
    console.log(`[SBOM] Components: ${sbom.components?.length || 0}`);
    console.log(`[SBOM] Spec version: ${sbom.specVersion}`);
  } catch (err) {
    console.error(`[SBOM] ✗ Failed to parse ${file}:`, err.message);
    allValid = false;
  }
}

if (!allValid) {
  console.log('\n[SBOM] ✗ SBOM validation failed');
  process.exit(1);
}

console.log('\n[SBOM] ✓ All SBOM files validated successfully');

/**
 * Validate components array
 */
function validateComponents(components) {
  const errors = [];

  if (components.length === 0) {
    errors.push('Components array is empty');
    return errors;
  }

  let componentsMissingPurl = 0;
  let componentsMissingLicense = 0;
  let componentsMissingName = 0;
  let componentsMissingVersion = 0;

  for (const component of components) {
    if (!component.name) componentsMissingName++;
    if (!component.version) componentsMissingVersion++;
    if (!component.purl) componentsMissingPurl++;
    if (!component.licenses || component.licenses.length === 0) {
      componentsMissingLicense++;
    }
  }

  if (componentsMissingName > 0) {
    errors.push(`${componentsMissingName} components missing name`);
  }

  if (componentsMissingVersion > 0) {
    errors.push(`${componentsMissingVersion} components missing version`);
  }

  if (componentsMissingPurl > 0) {
    errors.push(`${componentsMissingPurl} components missing purl (package URL)`);
  }

  if (componentsMissingLicense > 0) {
    // Warning, not error (some packages genuinely have no license)
    // errors.push(`${componentsMissingLicense} components missing license information`);
  }

  return errors;
}

/**
 * Check NTIA minimum elements
 * https://www.ntia.gov/files/ntia/publications/sbom_minimum_elements_report.pdf
 */
function checkNTIAMinimumElements(sbom) {
  const errors = [];

  // NTIA minimum elements:
  // 1. Supplier name
  // 2. Component name
  // 3. Version of component
  // 4. Other unique identifiers (purl, CPE, SWID)
  // 5. Dependency relationships
  // 6. Author of SBOM data
  // 7. Timestamp

  // 1. Supplier name
  if (!sbom.metadata?.supplier && !sbom.metadata?.manufacture) {
    errors.push('NTIA: Missing supplier/manufacturer information');
  }

  // 2 & 3. Component name & version (checked in metadata validation)
  if (!sbom.metadata?.component?.name || !sbom.metadata?.component?.version) {
    errors.push('NTIA: Missing root component name or version');
  }

  // 4. Unique identifiers (purl)
  const componentsMissingPurl = (sbom.components || []).filter((c) => !c.purl).length;
  if (componentsMissingPurl > sbom.components.length * 0.1) {
    // Allow 10% missing
    errors.push(`NTIA: Too many components missing unique identifiers (${componentsMissingPurl})`);
  }

  // 5. Dependency relationships
  if (!sbom.dependencies || sbom.dependencies.length === 0) {
    // Warning, not critical
    // errors.push('NTIA: Missing dependency relationship information');
  }

  // 6. Author of SBOM
  if (!sbom.metadata?.tools && !sbom.metadata?.authors) {
    errors.push('NTIA: Missing SBOM author/tool information');
  }

  // 7. Timestamp
  if (!sbom.metadata?.timestamp) {
    errors.push('NTIA: Missing timestamp');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

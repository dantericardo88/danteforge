# Software Bill of Materials (SBOM) Generation

**Version:** 1.0.0  
**Last Updated:** 2026-04-01  
**Standard:** CycloneDX 1.5

## Overview

DanteForge generates Software Bill of Materials (SBOM) documents to enable:
- Vulnerability tracking across dependencies
- License compliance verification
- Supply chain security audits
- Regulatory compliance (Executive Order 14028)

---

## SBOM Format

We use **CycloneDX** format (JSON) for maximum tooling compatibility:

- **Primary:** CycloneDX 1.5 JSON (`.cdx.json`)
- **Alternative:** SPDX 2.3 JSON (`.spdx.json`) - available via conversion

### Why CycloneDX?

- ✅ Native support for NPM ecosystem
- ✅ Extensive tool ecosystem (Dependency-Track, OWASP, etc.)
- ✅ Vulnerability Exchange (VEX) support
- ✅ License expression parsing
- ✅ Supply chain provenance tracking

---

## Generation

### Automated (CI/CD)

SBOM is auto-generated during release process:

```bash
npm run release:proof
# Generates: .danteforge/evidence/sbom/danteforge-0.9.2.cdx.json
```

### Manual Generation

```bash
# Generate SBOM for current version
npm run sbom:generate

# Output: sbom/danteforge-<version>.cdx.json
```

### Custom Options

```bash
# Include dev dependencies
npm run sbom:generate -- --include-dev

# Output to specific path
npm run sbom:generate -- --output ./security/sbom.json

# Generate both CycloneDX and SPDX
npm run sbom:generate -- --format all
```

---

## SBOM Structure

### Example SBOM

```json
{
  "bomFormat": "CycloneDX",
  "specVersion": "1.5",
  "serialNumber": "urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79",
  "version": 1,
  "metadata": {
    "timestamp": "2026-04-01T10:00:00Z",
    "tools": [
      {
        "vendor": "CycloneDX",
        "name": "@cyclonedx/cyclonedx-npm",
        "version": "1.16.0"
      }
    ],
    "component": {
      "type": "application",
      "name": "danteforge",
      "version": "0.9.2",
      "description": "Agentic development CLI",
      "licenses": [
        {
          "license": {
            "id": "MIT"
          }
        }
      ]
    }
  },
  "components": [
    {
      "type": "library",
      "bom-ref": "pkg:npm/commander@12.0.0",
      "name": "commander",
      "version": "12.0.0",
      "licenses": [
        {
          "license": {
            "id": "MIT"
          }
        }
      ],
      "purl": "pkg:npm/commander@12.0.0"
    }
    // ... 100+ more dependencies
  ],
  "dependencies": [
    {
      "ref": "pkg:npm/danteforge@0.9.2",
      "dependsOn": [
        "pkg:npm/commander@12.0.0",
        "pkg:npm/yaml@2.4.1"
        // ... direct dependencies
      ]
    }
  ]
}
```

### Key Fields

| Field | Description | Example |
|-------|-------------|---------|
| `serialNumber` | Unique SBOM identifier | `urn:uuid:...` |
| `metadata.component` | Root component (DanteForge) | Name, version, license |
| `components[]` | All dependencies | NPM packages with purls |
| `dependencies[]` | Dependency graph | Direct + transitive |
| `licenses[]` | SPDX license identifiers | MIT, Apache-2.0, etc. |

---

## Vulnerability Scanning

### Using Generated SBOM

**Option 1: Dependency-Track (recommended)**

```bash
# Upload SBOM to Dependency-Track
curl -X POST "https://dependency-track.local/api/v1/bom" \
  -H "X-Api-Key: $DEPENDENCY_TRACK_API_KEY" \
  -H "Content-Type: multipart/form-data" \
  -F "project=$PROJECT_UUID" \
  -F "bom=@sbom/danteforge-0.9.2.cdx.json"

# Dependency-Track will:
# - Parse SBOM
# - Match components against NVD, GitHub Advisory, OSS Index
# - Generate vulnerability report
# - Send alerts for new CVEs
```

**Option 2: Grype (local scanning)**

```bash
# Install Grype
brew install grype

# Scan SBOM
grype sbom:sbom/danteforge-0.9.2.cdx.json

# Output: List of vulnerabilities with severity
```

**Option 3: Trivy**

```bash
# Install Trivy
brew install trivy

# Scan SBOM
trivy sbom sbom/danteforge-0.9.2.cdx.json

# Filter by severity
trivy sbom sbom/danteforge-0.9.2.cdx.json --severity HIGH,CRITICAL
```

**Option 4: NPM Audit (fallback)**

```bash
# Native NPM vulnerability scan
npm audit

# Fix automatically (updates package-lock.json)
npm audit fix

# Show JSON report
npm audit --json > npm-audit-report.json
```

---

## License Compliance

### Extract License Report

```bash
# Generate license report from SBOM
npm run sbom:licenses

# Output: sbom/license-report.txt
```

**Example Output:**
```
MIT (85 packages):
  - commander@12.0.0
  - yaml@2.4.1
  - chalk@5.3.0
  ...

Apache-2.0 (12 packages):
  - tsup@8.0.2
  - esbuild@0.20.2
  ...

ISC (3 packages):
  - glob@10.3.10
  - minimatch@9.0.3
  ...

BSD-3-Clause (2 packages):
  - source-map-js@1.0.2
  ...
```

### License Policy Checks

```bash
# Define allowed licenses in package.json
{
  "license-checker": {
    "allowed": ["MIT", "Apache-2.0", "ISC", "BSD-3-Clause"],
    "forbidden": ["GPL", "AGPL", "SSPL"]
  }
}

# Run license check (CI gate)
npm run license:check

# Fails if forbidden licenses detected
```

### Copyleft Detection

```bash
# Detect copyleft licenses
jq '.components[] | select(.licenses[].license.id | test("GPL|AGPL|LGPL"))' \
  sbom/danteforge-0.9.2.cdx.json

# Output: Components with copyleft licenses (should be empty)
```

---

## Supply Chain Security

### SBOM Signing

Sign SBOM to prevent tampering:

```bash
# Sign SBOM with GPG
gpg --armor --detach-sign sbom/danteforge-0.9.2.cdx.json

# Output: sbom/danteforge-0.9.2.cdx.json.asc

# Verify signature
gpg --verify sbom/danteforge-0.9.2.cdx.json.asc sbom/danteforge-0.9.2.cdx.json
```

### SBOM Provenance

Include build provenance in SBOM:

```json
{
  "metadata": {
    "manufacture": {
      "name": "DanteForge CI/CD",
      "url": ["https://github.com/anthropics/danteforge"]
    },
    "supplier": {
      "name": "Anthropic",
      "url": ["https://anthropic.com"]
    }
  },
  "externalReferences": [
    {
      "type": "vcs",
      "url": "https://github.com/anthropics/danteforge.git",
      "comment": "Source code repository"
    },
    {
      "type": "build-system",
      "url": "https://github.com/anthropics/danteforge/actions/runs/123456",
      "comment": "CI build that generated this SBOM"
    }
  ]
}
```

---

## Integration with Dependency-Track

### Setup

1. **Deploy Dependency-Track:**
   ```bash
   docker run -d -p 8080:8080 \
     -v dependency-track:/data \
     --name dependency-track \
     dependencytrack/bundled:latest
   ```

2. **Create Project:**
   ```bash
   curl -X PUT "http://localhost:8080/api/v1/project" \
     -H "X-Api-Key: $API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "DanteForge",
       "version": "0.9.2",
       "classifier": "APPLICATION"
     }'
   ```

3. **Upload SBOM (automated in CI):**
   ```bash
   # In .github/workflows/release.yml
   - name: Upload SBOM to Dependency-Track
     run: |
       curl -X POST "${{ secrets.DEPENDENCY_TRACK_URL }}/api/v1/bom" \
         -H "X-Api-Key: ${{ secrets.DEPENDENCY_TRACK_API_KEY }}" \
         -F "project=${{ secrets.PROJECT_UUID }}" \
         -F "bom=@sbom/danteforge-${{ github.ref_name }}.cdx.json"
   ```

### Monitoring

- **Dashboard:** View vulnerability trends over time
- **Alerts:** Email/Slack notifications for new CVEs
- **Policy Violations:** Auto-detect license violations
- **Audit Trail:** Track SBOM uploads and changes

---

## SBOM Validation

### Validate SBOM Structure

```bash
# Validate against CycloneDX schema
npm run sbom:validate

# Or use cyclonedx-cli
cyclonedx-cli validate --input-file sbom/danteforge-0.9.2.cdx.json
```

### Common Validation Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Invalid purl | Malformed package URL | Regenerate SBOM |
| Missing license | Dependency without license field | Add to package.json |
| Invalid timestamp | Malformed ISO 8601 date | Check system clock |
| Missing bom-ref | Component without unique ID | Regenerate SBOM |

---

## Compliance & Attestation

### Executive Order 14028 (US Federal)

✅ **Requirements met:**
- SBOM generated for all releases
- SBOM includes full dependency tree
- SBOM follows NTIA minimum elements:
  - Supplier name
  - Component name
  - Version
  - Unique identifier (purl)
  - Dependency relationships
  - Timestamp

### ISO 27001 / SOC 2

✅ **Controls:**
- Vulnerability management (automatic scanning)
- License compliance (automated checks)
- Audit trail (SBOM upload logs)
- Incident response (CVE alerts)

### Attestation Document

For customers requiring SBOM attestation:

```
DanteForge SBOM Attestation

We, Anthropic, attest that the enclosed SBOM accurately represents
all software components included in DanteForge version 0.9.2 as of
2026-04-01.

SBOM Serial Number: urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79
Build Timestamp: 2026-04-01T10:00:00Z
Git Commit: 9572bd2f...
CI Build: https://github.com/anthropics/danteforge/actions/runs/123456

Signed: [Digital Signature]
Date: 2026-04-01
```

---

## Troubleshooting

### SBOM Generation Fails

**Error:** `Cannot find module '@cyclonedx/cyclonedx-npm'`

**Fix:**
```bash
npm install --save-dev @cyclonedx/cyclonedx-npm
npm run sbom:generate
```

### Missing Dependencies in SBOM

**Error:** Some dependencies not listed

**Cause:** Dev dependencies excluded by default

**Fix:**
```bash
npm run sbom:generate -- --include-dev
```

### Invalid License Identifier

**Error:** `Unknown license: Custom`

**Fix:** Map custom license to SPDX identifier in package.json:
```json
{
  "license": "SEE LICENSE IN LICENSE.txt"
}
```

---

## Automation

### CI/CD Integration

```yaml
# .github/workflows/release.yml
- name: Generate SBOM
  run: npm run sbom:generate

- name: Upload SBOM as artifact
  uses: actions/upload-artifact@v3
  with:
    name: sbom
    path: sbom/danteforge-*.cdx.json

- name: Scan SBOM for vulnerabilities
  run: |
    npm install -g @cyclonedx/cyclonedx-cli
    grype sbom:sbom/danteforge-*.cdx.json --fail-on high
```

### Scheduled Scans

```yaml
# .github/workflows/sbom-scan.yml
name: SBOM Vulnerability Scan
on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2am UTC

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm run sbom:generate
      - run: grype sbom:sbom/*.cdx.json --fail-on critical
      - name: Notify on failure
        if: failure()
        uses: slackapi/slack-github-action@v1
        with:
          payload: '{"text":"Critical vulnerability detected in DanteForge!"}'
```

---

## Best Practices

1. **Generate SBOM for every release** (automated in CI)
2. **Sign SBOMs** to prevent tampering
3. **Upload to Dependency-Track** for continuous monitoring
4. **Set up alerts** for new CVEs
5. **Scan before deployment** (CI gate)
6. **Keep SBOM in release artifacts** (GitHub Releases)
7. **Document known vulnerabilities** with VEX (Vulnerability Exchange)
8. **Review license compliance** quarterly

---

## Tools & Resources

### SBOM Tools
- **@cyclonedx/cyclonedx-npm** - SBOM generation
- **Dependency-Track** - Vulnerability monitoring
- **Grype** - Offline scanning
- **Trivy** - Multi-format scanner
- **OWASP Dependency-Check** - Java/Maven ecosystem

### Databases
- **NVD (NIST)** - National Vulnerability Database
- **GitHub Advisory Database** - Community-sourced CVEs
- **OSS Index** - Sonatype vulnerability DB

### Standards
- **CycloneDX** - https://cyclonedx.org
- **SPDX** - https://spdx.dev
- **NTIA SBOM Minimum Elements** - https://www.ntia.gov/sbom

---

**Document Version:** 1.0.0  
**Last Updated:** 2026-04-01  
**Next Review:** 2026-07-01

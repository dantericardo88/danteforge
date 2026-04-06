# Publishing DanteForge to npm

## Prerequisites

1. npm account with publish access to the `danteforge` package
2. `NPM_TOKEN` secret added to GitHub repo settings → Secrets and Variables → Actions
3. All release checks passing: `npm run release:check`

## Automated Release (Recommended)

The CI pipeline in `.github/workflows/release.yml` handles publishing automatically when a version tag is pushed.

```bash
# 1. Ensure you're on main with a clean working tree
git status

# 2. Update version in package.json (pick one)
npm version patch    # 0.10.0 → 0.10.1  (bug fixes)
npm version minor    # 0.10.0 → 0.11.0  (new features)
npm version major    # 0.10.0 → 1.0.0   (breaking changes)

# 3. Push the version tag — this triggers release.yml
git push origin main --tags
```

GitHub Actions will then:
1. Run repo hygiene checks
2. Run `npm run verify` (typecheck + lint + tests)
3. Run `npm run build`
4. Run release readiness checks
5. Run `npm publish --provenance --access public` with OIDC signing
6. Package and publish the VS Code extension (if VSCE_PAT is set)

## Manual Release (Fallback)

If GitHub Actions is unavailable, publish manually from a clean checkout:

```bash
# Fresh checkout to avoid local file contamination
git clone https://github.com/danteforge/danteforge.git df-release
cd df-release

# Install and verify
npm ci
npm run verify
npm run build

# Confirm release checks pass
npm run release:check

# Publish with provenance (requires npm 9+ and Node 18+)
npm publish --provenance --access public
```

## Post-Publish Verification

After publishing, verify the package is installable in a clean environment:

```bash
# In a temporary directory
mkdir /tmp/df-test && cd /tmp/df-test
npm install -g danteforge@latest
danteforge --version
danteforge init
```

## Versioning Policy

DanteForge follows [Semantic Versioning](https://semver.org/):

| Change type | Version bump | Example |
|---|---|---|
| Bug fixes, docs, test additions | `patch` | 0.10.0 → 0.10.1 |
| New commands, new dimensions, new competitors | `minor` | 0.10.0 → 0.11.0 |
| Breaking changes to CLI interface, config format, or state schema | `major` | 0.10.0 → 1.0.0 |

## Release Checklist

Before tagging a release, verify:

- [ ] `npm run verify` passes (typecheck + lint + all tests)
- [ ] `npm run build` produces clean `dist/index.js`
- [ ] `CHANGELOG.md` updated with new version entry
- [ ] `CURRENT_STATE.md` reflects current state
- [ ] No `TODO:` or `STUB:` markers in production code paths
- [ ] `npm run release:check` passes all gates
- [ ] Git working tree is clean (`git status` shows nothing)

## npm Token Setup

1. Login to npmjs.com → Account → Access Tokens → Generate New Token
2. Select "Automation" type (for CI use)
3. Copy the token (shown only once)
4. In GitHub: repo Settings → Secrets and Variables → Actions → New repository secret
5. Name: `NPM_TOKEN`, Value: paste token
6. The `release.yml` workflow references `secrets.NPM_TOKEN` automatically

# DanteForge Workspace Guide

Workspaces enable multi-user projects with role-based access control.

## Concepts

| Term | Meaning |
|---|---|
| Workspace | A named configuration shared across a team for a project |
| Member | A user with a role in the workspace |
| Role | `owner`, `editor`, or `reviewer` — controls what commands you can run |

## Roles

| Role | Permitted commands |
|---|---|
| **owner** | All commands including `config`, `premium activate`, `workspace invite` |
| **editor** | `forge`, `verify`, `assess`, `plan`, `tasks`, and all read commands |
| **reviewer** | `assess`, `maturity`, `workflow`, `universe`, `dashboard` (read-only) |

## Getting Started

### Create a workspace
```bash
danteforge workspace create myteam
# Workspace 'myteam' created (id: myteam)
# Set active: export DANTEFORGE_WORKSPACE=myteam
```

### Activate a workspace
```bash
export DANTEFORGE_WORKSPACE=myteam
```

Or add to your shell profile for persistence:
```bash
echo 'export DANTEFORGE_WORKSPACE=myteam' >> ~/.bashrc
```

### Check workspace status
```bash
danteforge workspace status
# Workspace: myteam (myteam)
# Members:
#   owner      alice ← you
#   editor     bob
#   reviewer   carol
```

### Invite team members
```bash
danteforge workspace invite bob --role editor
danteforge workspace invite carol --role reviewer
```

## Multi-User Setup

Each team member:
1. Installs DanteForge: `npm install -g danteforge`
2. Sets the workspace: `export DANTEFORGE_WORKSPACE=myteam`
3. Runs commands according to their role

The workspace config is stored at `~/.danteforge/workspaces/{id}/config.yaml`. In a team environment, you can share this file or check it into a shared configuration repository.

## CI/CD Integration

For CI/CD pipelines, use environment variables:
```bash
export DANTEFORGE_WORKSPACE=myteam
export DANTEFORGE_USER=ci-bot
export DANTEFORGE_LICENSE_KEY=DF-PRO-20261231-YOURKEY
danteforge assess --json
```

## Single-User Mode

If `DANTEFORGE_WORKSPACE` is not set, DanteForge runs in single-user mode — all commands are permitted and no role checks apply. This is the default for individual developers.

## Identity

In v0.10.0, identity is determined by `DANTEFORGE_USER` environment variable or `os.userInfo().username`. Cryptographic verification (OAuth, signed tokens) is planned for v0.11.0.

## Audit Trail

All commands stamp the current user ID on audit log entries:
```
2026-04-05T10:00:00Z | alice | forge: task-1 completed
2026-04-05T10:05:00Z | bob | verify: pass
```

Export audit logs:
```bash
danteforge audit-export --format json --since 2026-04-01  # requires pro tier
```

---
name: review
description: "Review the current project — scan repo and generate CURRENT_STATE.md"
---

# /review — Project Review

When the user invokes `/review`, follow this workflow:

1. **Scan repository**: Read file tree, dependencies, recent commits
2. **Filter intelligently**: Skip binaries, lock files, build artifacts
3. **Generate CURRENT_STATE.md**: Include:
   - Project overview (name, version, tech stack)
   - Dependencies (runtime + dev)
   - Recent git history
   - File structure
   - Existing planning documents
   - Workflow stage and completion tracking
   - Recommended next steps
4. **Save**: Write to `.danteforge/CURRENT_STATE.md`
5. **Next step**: Suggest running `/specify` to start building

This is the entry point for existing projects.

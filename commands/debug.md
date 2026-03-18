---
name: debug
description: "Systematic debugging — 4-phase root-cause analysis framework"
---

# /debug — Systematic Debugging

When the user invokes `/debug`, follow this workflow:

1. **Gather the issue**: Ask for a clear description of the bug or unexpected behavior
2. **Load the systematic-debugging skill** and follow its 4 phases EXACTLY:

**Phase 1: Root Cause Investigation** (NO fixes allowed)
- Read error messages thoroughly
- Reproduce the issue consistently
- Review recent changes
- Trace data flow backward

**Phase 2: Pattern Analysis**
- Find working examples in the codebase
- List differences between working and broken code
- Document assumptions

**Phase 3: Hypothesis and Testing**
- Form specific hypotheses
- Test with minimal changes
- Verify results

**Phase 4: Implementation**
- Write a failing test (TDD)
- Implement single root-cause fix
- Verify without breaking other tests

**Escalation**: If 3+ fix attempts fail, stop and question the architecture.

Use the `systematic-debugging` skill throughout.
Use the `test-driven-development` skill in Phase 4.

---
name: lessons
description: "Capture corrections and failures as persistent rules — self-improving agent memory"
---

# /lessons — Self-Improving Lessons

When the user invokes `/lessons`, follow this workflow:

1. **Accept correction**: If correction text provided, extract lesson immediately
2. **Structure lesson**: For each correction, capture:
   - What went wrong (the mistake)
   - Why it happened (root cause)
   - The rule to follow going forward
   - Category tag (workflow, platform, naming, testing, etc.)
3. **Save**: Append to `.danteforge/lessons.md`
4. **Auto-compact**: If file exceeds threshold, summarize and compact old entries
5. **Feed forward**: Lessons are automatically injected into forge, party, tech-decide, and verify contexts

Options:
- `--compact` — Force compaction of lessons file
- `--prompt` — Generate a copy-paste prompt instead of auto-executing

Use the `lessons` skill for structured lesson extraction patterns.

CLI fallback: `danteforge lessons "correction text"`

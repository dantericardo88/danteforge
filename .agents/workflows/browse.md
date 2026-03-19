---
name: browse
description: "Browser automation — navigate, screenshot, inspect live apps"
---

# /browse — Browser Automation

When the user invokes `/browse`, follow this workflow:

1. **Accept target**: Take a URL or subcommand (goto, screenshot, inspect, evaluate)
2. **Launch browser**: Start headless browser daemon if not running
3. **Execute action**:
   - `goto <url>` — Navigate to URL
   - `screenshot` — Capture current page
   - `inspect` — Inspect DOM elements
   - `evaluate <script>` — Run JavaScript in page context
4. **Return results**: Show screenshot, DOM data, or script output

Options:
- `--url <url>` — Target URL (shorthand for goto)
- `--port <port>` — Override browse daemon port (default: 9400)

CLI fallback: `danteforge browse <subcommand> [args...]`

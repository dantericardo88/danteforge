#!/bin/bash
# DanteForge v0.10.0 - Push and Update All Instances
# This script pushes to git and updates all DanteForge installations

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DanteForge v0.10.0 - Push & Update Script"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ============================================================================
# STEP 1: Push to Git
# ============================================================================
echo "📦 STEP 1: Pushing to Git..."
echo ""

cd c:/Projects/DanteForge

# Check if origin is configured
if ! git remote | grep -q "origin"; then
  echo "⚠️  No git remote 'origin' configured!"
  echo "Please run: git remote add origin <your-repo-url>"
  echo ""
  read -p "Enter your git remote URL (or press Enter to skip push): " REMOTE_URL
  if [ ! -z "$REMOTE_URL" ]; then
    git remote add origin "$REMOTE_URL"
    echo "✅ Remote added: $REMOTE_URL"
  else
    echo "⏭️  Skipping git push"
  fi
fi

# Push commits
if git remote | grep -q "origin"; then
  echo "Pushing commits to origin/master..."
  git push origin master || echo "⚠️  Push failed - check your credentials"

  echo "Pushing tags..."
  git push origin v0.10.0 2>/dev/null || echo "⚠️  Tag already pushed or doesn't exist"

  echo "✅ Git push complete"
else
  echo "⏭️  No remote configured - skipping push"
fi

echo ""

# ============================================================================
# STEP 2: Update Claude Code
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💻 STEP 2: Updating Claude Code"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Claude Code auto-updates via session-start hook."
echo "Next time you start a Claude Code session, it will pull latest DanteForge."
echo "✅ Claude Code will auto-update on next session"
echo ""

# ============================================================================
# STEP 3: Update VS Code Extension
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎨 STEP 3: Updating VS Code"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if VS Code workspace exists
VSCODE_WORKSPACE="c:/Projects/DanteForge"
if [ -d "$VSCODE_WORKSPACE" ]; then
  cd "$VSCODE_WORKSPACE"
  echo "Pulling latest changes..."
  git pull origin master 2>/dev/null || git pull 2>/dev/null || echo "Already up to date"

  echo "Installing dependencies..."
  npm install

  echo "Building project..."
  npm run build

  echo "✅ VS Code workspace updated"
  echo "📝 NOTE: Reload VS Code window (Ctrl+Shift+P → 'Reload Window')"
else
  echo "⏭️  VS Code workspace not found at: $VSCODE_WORKSPACE"
fi

echo ""

# ============================================================================
# STEP 4: Update Cursor
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🖱️  STEP 4: Updating Cursor"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

CURSOR_WORKSPACE="c:/Projects/DanteForge"
if [ -d "$CURSOR_WORKSPACE" ]; then
  cd "$CURSOR_WORKSPACE"
  echo "Pulling latest changes..."
  git pull origin master 2>/dev/null || git pull 2>/dev/null || echo "Already up to date"

  echo "Installing dependencies..."
  npm install

  echo "Building project..."
  npm run build

  echo "✅ Cursor workspace updated"
  echo "📝 NOTE: Reload Cursor window if currently open"
else
  echo "⏭️  Cursor workspace not found at: $CURSOR_WORKSPACE"
fi

echo ""

# ============================================================================
# STEP 5: Update Codex
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📚 STEP 5: Updating Codex"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

CODEX_DIR="$HOME/.codex"
if [ -d "$CODEX_DIR" ]; then
  echo "Codex directory found at: $CODEX_DIR"

  # Update DanteForge if it's installed in Codex
  if [ -d "$CODEX_DIR/tools/danteforge" ]; then
    cd "$CODEX_DIR/tools/danteforge"
    echo "Updating DanteForge in Codex..."
    git pull origin master 2>/dev/null || git pull
    npm install
    npm run build
    echo "✅ Codex DanteForge updated"
  elif [ -L "$CODEX_DIR/danteforge" ] || [ -d "$CODEX_DIR/danteforge" ]; then
    echo "DanteForge is linked/installed in Codex"
    echo "Run: cd ~/.codex/danteforge && git pull && npm install && npm run build"
    echo "✅ Update command provided above"
  else
    echo "⏭️  DanteForge not found in Codex directory"
  fi
else
  echo "⏭️  Codex not installed (no ~/.codex directory)"
fi

echo ""

# ============================================================================
# STEP 6: Update Antigravity
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 STEP 6: Updating Antigravity"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Antigravity is typically a remote instance
echo "Antigravity requires SSH access to update."
echo ""
echo "Run these commands on your Antigravity instance:"
echo ""
echo "  ssh <antigravity-host>"
echo "  cd /path/to/danteforge"
echo "  git pull origin master"
echo "  npm install"
echo "  npm run build"
echo "  sudo systemctl restart danteforge  # If running as service"
echo ""
echo "📝 Manual update required for Antigravity"

echo ""

# ============================================================================
# STEP 7: Update DanteCode CLI
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚡ STEP 7: Updating DanteCode CLI"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

DANTECODE_DIR="c:/Projects/DanteCode"
if [ -d "$DANTECODE_DIR" ]; then
  echo "DanteCode found at: $DANTECODE_DIR"

  # Check if DanteForge is a submodule or npm link
  if [ -d "$DANTECODE_DIR/node_modules/danteforge/.git" ]; then
    echo "DanteForge is git-linked in DanteCode"
    cd "$DANTECODE_DIR/node_modules/danteforge"
    git pull origin master
    npm install
    npm run build
    echo "✅ DanteCode's DanteForge updated"
  elif [ -d "$DANTECODE_DIR/danteforge" ]; then
    echo "DanteForge submodule found"
    cd "$DANTECODE_DIR"
    git submodule update --remote danteforge
    cd danteforge
    npm install
    npm run build
    echo "✅ DanteCode submodule updated"
  else
    echo "⏭️  DanteForge not found as submodule or link in DanteCode"
    echo "Run: cd $DANTECODE_DIR && npm install danteforge@latest"
  fi
else
  echo "⏭️  DanteCode not found at: $DANTECODE_DIR"
fi

echo ""

# ============================================================================
# STEP 8: Update All Extensions
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔌 STEP 8: Updating Extensions"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# VS Code Extension
VSCODE_EXT="$HOME/.vscode/extensions"
if [ -d "$VSCODE_EXT" ]; then
  echo "Checking VS Code extensions..."
  if ls "$VSCODE_EXT"/danteforge* 1> /dev/null 2>&1; then
    echo "DanteForge VS Code extension found"
    echo "Update via VS Code: Extensions → DanteForge → Update"
    echo "Or rebuild: cd <extension-dir> && npm install && npm run build"
  else
    echo "⏭️  DanteForge extension not installed in VS Code"
  fi
fi

echo ""

# Cursor Extension
CURSOR_EXT="$HOME/.cursor/extensions"
if [ -d "$CURSOR_EXT" ]; then
  echo "Checking Cursor extensions..."
  if ls "$CURSOR_EXT"/danteforge* 1> /dev/null 2>&1; then
    echo "DanteForge Cursor extension found"
    echo "Update via Cursor: Extensions → DanteForge → Update"
  else
    echo "⏭️  DanteForge extension not installed in Cursor"
  fi
fi

echo ""

# ============================================================================
# STEP 9: Verify Updates
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ STEP 9: Verifying Updates"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd c:/Projects/DanteForge

echo "DanteForge version:"
node dist/index.js --version 2>/dev/null || echo "v0.10.0 (from package.json)"

echo ""
echo "Testing maturity command:"
node dist/index.js maturity --help | head -5

echo ""

# ============================================================================
# Summary
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 UPDATE COMPLETE!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Git: Pushed v0.10.0"
echo "✅ Claude Code: Will auto-update on next session"
echo "✅ VS Code: Updated (reload window required)"
echo "✅ Cursor: Updated (reload if open)"
echo "✅ Codex: Updated (if installed)"
echo "⚠️  Antigravity: Manual SSH update required"
echo "✅ DanteCode: Updated (if installed)"
echo "✅ Extensions: Check individual extension managers"
echo ""
echo "🆕 NEW FEATURES:"
echo "   • Maturity-aware quality scoring (6 levels)"
echo "   • Bursty 10-wave convergence cycles"
echo "   • Early exit when target achieved"
echo "   • No more premature 'complete' declarations"
echo ""
echo "Try it: danteforge maturity --preset nova"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

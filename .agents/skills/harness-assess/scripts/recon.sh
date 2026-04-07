#!/usr/bin/env bash
# recon.sh — Quick reconnaissance of a harness codebase
# Usage: bash recon.sh /path/to/repo

set -euo pipefail

REPO="${1:-.}"
cd "$REPO"

echo "=== HARNESS RECON: $(basename "$PWD") ==="
echo "Path: $PWD"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# --- Project type ---
echo "=== PROJECT TYPE ==="
for f in package.json Cargo.toml go.mod pyproject.toml setup.py build.gradle pom.xml Makefile; do
  [ -f "$f" ] && echo "  Found: $f"
done
echo ""

# --- Language breakdown (quick) ---
echo "=== LANGUAGE BREAKDOWN ==="
if command -v rg &>/dev/null; then
  for ext in ts tsx js jsx py rs go java rb sh bash; do
    count=$(find . -name "*.${ext}" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/build/*" -not -path "*/vendor/*" 2>/dev/null | wc -l)
    [ "$count" -gt 0 ] && echo "  .${ext}: ${count} files"
  done
fi
echo ""

# --- Directory tree (3 levels, no noise) ---
echo "=== DIRECTORY TREE (3 levels) ==="
if command -v tree &>/dev/null; then
  tree -L 3 -I 'node_modules|.git|dist|build|vendor|__pycache__|.next|coverage|.turbo|target' --dirsfirst -F 2>/dev/null || find . -maxdepth 3 -type d -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" | sort
else
  find . -maxdepth 3 -type d -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/build/*" | sort
fi
echo ""

# --- Dependencies (top 30) ---
echo "=== KEY DEPENDENCIES ==="
if [ -f package.json ]; then
  echo "  [package.json dependencies]"
  cat package.json | grep -A 100 '"dependencies"' | grep -B 0 "}" | head -35 | grep '"' | sed 's/[",]//g' | awk '{print "  " $1, $2}'
  echo "  [package.json devDependencies]"
  cat package.json | grep -A 100 '"devDependencies"' | grep -B 0 "}" | head -20 | grep '"' | sed 's/[",]//g' | awk '{print "  " $1, $2}'
elif [ -f Cargo.toml ]; then
  echo "  [Cargo.toml dependencies]"
  grep -A 50 '^\[dependencies\]' Cargo.toml | head -30 | sed 's/^/  /'
elif [ -f go.mod ]; then
  echo "  [go.mod requires]"
  grep -A 30 '^require' go.mod | head -30 | sed 's/^/  /'
elif [ -f pyproject.toml ]; then
  echo "  [pyproject.toml dependencies]"
  grep -A 30 'dependencies' pyproject.toml | head -30 | sed 's/^/  /'
fi
echo ""

# --- Entry points ---
echo "=== ENTRY POINTS ==="
for pattern in "main.ts" "main.rs" "main.go" "main.py" "index.ts" "index.js" "cli.ts" "cli.js" "app.ts" "app.py" "mod.rs" "cmd/*.go"; do
  found=$(find . -maxdepth 4 -path "*/${pattern}" -not -path "*/node_modules/*" -not -path "*/dist/*" 2>/dev/null)
  [ -n "$found" ] && echo "$found" | sed 's/^/  /'
done
# Also check package.json bin field
if [ -f package.json ]; then
  bin_entries=$(cat package.json | grep -A 5 '"bin"' 2>/dev/null | head -6)
  [ -n "$bin_entries" ] && echo "  [package.json bin]:" && echo "$bin_entries" | sed 's/^/    /'
fi
echo ""

# --- Config files ---
echo "=== CONFIG FILES ==="
find . -maxdepth 3 \( \
  -name "*.config.*" -o -name "*.yaml" -o -name "*.yml" -o \
  -name "*.toml" -o -name "*.env*" -o -name ".claude*" -o \
  -name "CLAUDE.md" -o -name "AGENTS.md" -o -name ".cursorrules" -o \
  -name "*.plist" -o -name "*.service" \
\) -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" 2>/dev/null | sort | sed 's/^/  /'
echo ""

# --- Architecture signals ---
echo "=== ARCHITECTURE SIGNALS ==="

echo "  [State machines]"
rg -l "createMachine|StateMachine|xstate|state.*machine" --type=ts --type=py --type=rs 2>/dev/null | head -5 | sed 's/^/    /' || echo "    (none found)"

echo "  [Database schemas]"
find . -maxdepth 4 \( -name "*.sql" -o -name "*schema*" -o -name "*migration*" \) -not -path "*/node_modules/*" 2>/dev/null | head -5 | sed 's/^/    /' || echo "    (none found)"

echo "  [CLI commands]"
rg -l "command\(|\.command|addCommand|register.*command" --type=ts --type=py --type=go 2>/dev/null | head -5 | sed 's/^/    /' || echo "    (none found)"

echo "  [Spawn/process management]"
rg -l "spawn|child_process|subprocess|Bun\.spawn|Command::new" --type=ts --type=py --type=rs 2>/dev/null | head -5 | sed 's/^/    /' || echo "    (none found)"

echo "  [Model API calls]"
rg -l "anthropic|openai|ChatCompletion|messages\.create" --type=ts --type=py --type=rs 2>/dev/null | head -5 | sed 's/^/    /' || echo "    (none found)"

echo "  [Git worktree]"
rg -l "worktree" --type=ts --type=py --type=rs --type=sh 2>/dev/null | head -5 | sed 's/^/    /' || echo "    (none found)"

echo "  [Hooks/middleware]"
rg -l "PreToolUse|PostToolUse|hook|Hook|intercept" --type=ts --type=py 2>/dev/null | head -5 | sed 's/^/    /' || echo "    (none found)"

echo "  [tmux]"
rg -l "tmux|send-keys|capture-pane" 2>/dev/null | head -5 | sed 's/^/    /' || echo "    (none found)"

echo "  [Verification/quality gates]"
rg -l "verif|validat|quality.*gate|lint.*gate|test.*gate|blind.*valid|self.*review" --type=ts --type=py --type=rs --type=go 2>/dev/null | head -5 | sed 's/^/    /' || echo "    (none found)"

echo "  [Caching]"
rg -l "cache|Cache|prompt.*cache|memoize|cache_control" --type=ts --type=py --type=rs --type=go 2>/dev/null | head -5 | sed 's/^/    /' || echo "    (none found)"

echo "  [Agent protocols (MCP/ACP/A2A)]"
rg -l "MCP|agent.*client.*protocol|agentclientprotocol|A2A|agent2agent|json.rpc|model.*context.*protocol" --type=ts --type=py --type=rs --type=go 2>/dev/null | head -5 | sed 's/^/    /' || echo "    (none found)"

echo "  [Edit format/code modification]"
rg -l "search.*replace|EditFormat|edit.*format|diff.*apply|patch.*apply" --type=ts --type=py --type=rs --type=go 2>/dev/null | head -5 | sed 's/^/    /' || echo "    (none found)"

echo ""

# --- README excerpt ---
echo "=== README (first 40 lines) ==="
if [ -f README.md ]; then
  head -40 README.md | sed 's/^/  /'
elif [ -f readme.md ]; then
  head -40 readme.md | sed 's/^/  /'
else
  echo "  (no README.md found)"
fi
echo ""

echo "=== RECON COMPLETE ==="

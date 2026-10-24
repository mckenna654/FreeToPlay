#!/bin/bash
# Installs this project's dependencies at the start of a Claude Code CLOUD session, so tests and
# builds work straight away. Does nothing on your own computer. Skips work already done.
[ "$CLAUDE_CODE_REMOTE" = "true" ] || exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
stamp=.claude/.deps-installed.sha256

inputs=$(ls package.json package-lock.json requirements*.txt prisma/schema.prisma .claude/hooks/session-start.sh 2>/dev/null)
[ -n "$inputs" ] || exit 0
sha256sum --check --status "$stamp" 2>/dev/null && exit 0
rm -f "$stamp"

ok=1
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1 || ok=0
elif [ -f package.json ]; then npm install --no-audit --no-fund >/dev/null 2>&1 || ok=0; fi
[ -f prisma/schema.prisma ] && { npx --no-install prisma generate >/dev/null 2>&1 || ok=0; }
for r in requirements-dev.txt requirements.txt; do
  [ -f "$r" ] && { pip install -q -r "$r" >/dev/null 2>&1 || ok=0; break; }
done

if [ $ok = 1 ]; then sha256sum $inputs > "$stamp"; echo "Project dependencies installed."
else echo "Some dependencies failed to install; ask Claude to run the install and show the error."; fi
exit 0

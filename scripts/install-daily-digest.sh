#!/bin/bash
# Installs a launchd job that writes To-Do's daily brief every morning at 06:30.
#
#   bash scripts/install-daily-digest.sh          # install
#   bash scripts/install-daily-digest.sh --remove # uninstall
#
# The job runs `todo digest --auto`, which composes the brief from the vault
# locally — no network, no tokens. A brief Claude writes later the same day
# overwrites it, so this only ever guarantees a floor.

set -euo pipefail

LABEL="com.shawon.todo.digest"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$(command -v node)"

if [[ "${1:-}" == "--remove" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ removed $LABEL"
  exit 0
fi

if [[ -z "$NODE" ]]; then
  echo "✗ node not found on PATH" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/bin/todo.mjs</string>
    <string>digest</string>
    <string>--auto</string>
  </array>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>6</integer>
    <key>Minute</key><integer>30</integer>
  </dict>

  <!-- Catch up if the Mac was asleep at 06:30. -->
  <key>RunAtLoad</key>
  <false/>

  <key>StandardOutPath</key>
  <string>/tmp/$LABEL.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/$LABEL.err</string>
</dict>
</plist>
PLIST_EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "✓ installed $LABEL — runs daily at 06:30"
echo "  plist:  $PLIST"
echo "  log:    /tmp/$LABEL.log"
echo "  remove: bash scripts/install-daily-digest.sh --remove"

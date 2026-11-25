#!/bin/zsh
# Detiene y elimina la app de barra de menú, la API local y sus LaunchAgents.
set -uo pipefail
BUNDLE_ID="local.odoo-remember"
for id in "$BUNDLE_ID" "$BUNDLE_ID.api"; do
  launchctl bootout "gui/$(id -u)/$id" 2>/dev/null
  rm -f "$HOME/Library/LaunchAgents/$id.plist"
done
pkill -x OdooRemember 2>/dev/null
rm -rf "$HOME/Applications/OdooRemember.app"
echo "✓ OdooRemember desinstalado."

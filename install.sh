#!/bin/zsh
# Compila e instala:
#   1. La API local (Node) → LaunchAgent local.odoo-remember.api (http://127.0.0.1:$API_PORT)
#   2. La app de barra de menú (Swift) → ~/Applications/OdooRemember.app + LaunchAgent local.odoo-remember
# Ambos arrancan solos al iniciar sesión.
set -euo pipefail

ROOT="${0:A:h}"
APP_NAME="OdooRemember"
BUNDLE_ID="local.odoo-remember"
API_ID="$BUNDLE_ID.api"
DEST="$HOME/Applications/$APP_NAME.app"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs"
UID_GUI="gui/$(id -u)"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
BUILD="$(mktemp -d)"          # temporal: no dejar una segunda copia de la app
trap 'rm -rf "$BUILD"' EXIT

[[ -f "$ROOT/.env" ]] || { echo "No existe $ROOT/.env: copia .env.example a .env y llena tus datos de Odoo"; exit 1; }
NODE="$(command -v node)" || { echo "No se encontró node"; exit 1; }
API_PORT="$(grep -E '^API_PORT=' "$ROOT/.env" | cut -d= -f2 | tr -d '"'"'" || true)"
API_PORT="${API_PORT:-8787}"
API_URL="http://127.0.0.1:$API_PORT"

# ---------- 1. API + interfaz web ----------
echo "→ Compilando API e interfaz…"
cd "$ROOT"
pnpm install --frozen-lockfile --silent
pnpm build >/dev/null

# ---------- 2. App de barra de menú ----------
echo "→ Compilando app de barra de menú…"
APP="$BUILD/$APP_NAME.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -swift-version 5 -target arm64-apple-macos13 -o "$APP/Contents/MacOS/$APP_NAME" "$ROOT/macos/main.swift"

ICONSET="$BUILD/AppIcon.iconset"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$ROOT/Resources/logo.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$ROOT/Resources/logo.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>Odoo Asistencia</string>
  <key>CFBundleDisplayName</key><string>Odoo Asistencia</string>
  <key>CFBundleExecutable</key><string>$APP_NAME</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>2.0</string>
  <key>CFBundleVersion</key><string>2</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSLocationUsageDescription</key><string>Tu ubicación se registra en Odoo junto con cada entrada y salida.</string>
  <key>NSLocationWhenInUseUsageDescription</key><string>Tu ubicación se registra en Odoo junto con cada entrada y salida.</string>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
EOF
codesign --force --sign - "$APP" 2>/dev/null

# ---------- 3. Instalar ----------
echo "→ Instalando…"
launchctl bootout "$UID_GUI/$BUNDLE_ID" 2>/dev/null || true
launchctl bootout "$UID_GUI/$API_ID" 2>/dev/null || true
pkill -x "$APP_NAME" 2>/dev/null || true
mkdir -p "$HOME/Applications" "$AGENTS" "$LOGS"
rm -rf "$DEST"
cp -R "$APP" "$DEST"
"$LSREGISTER" -f "$DEST"
touch "$DEST"

cat > "$AGENTS/$API_ID.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$API_ID</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$ROOT/dist/server/index.js</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGS/OdooRemember-api.log</string>
  <key>StandardErrorPath</key><string>$LOGS/OdooRemember-api.log</string>
</dict>
</plist>
EOF

cat > "$AGENTS/$BUNDLE_ID.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$BUNDLE_ID</string>
  <key>ProgramArguments</key>
  <array><string>$DEST/Contents/MacOS/$APP_NAME</string><string>--api</string><string>$API_URL</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOGS/$APP_NAME.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$APP_NAME.log</string>
</dict>
</plist>
EOF

launchctl bootstrap "$UID_GUI" "$AGENTS/$API_ID.plist"
launchctl bootstrap "$UID_GUI" "$AGENTS/$BUNDLE_ID.plist"

# Esperar a que la API responda.
for _ in {1..20}; do curl -sf "$API_URL/api/health" >/dev/null && break; sleep 0.5; done
echo "✓ Listo."
echo "  Panel:  $API_URL  (o desde el icono de la barra de menú → Abrir panel)"
echo "  MCP:    claude mcp add --scope user odoo-remember -- node \"$ROOT/dist/server/mcp.js\""
echo "  Estado: $(curl -s "$API_URL/api/attendance/today" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).summary)}catch{console.log(s)}})')"

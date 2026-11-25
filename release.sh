#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# odoo-remember — Release script
# Uso: ./release.sh <versión>          Ejemplo: ./release.sh 1.1.0
#
# Qué hace (formato de notas: pgm-standards/shared/RELEASE-NOTES.MD):
#   1. Valida rama main, working tree limpio, versión semver y tag nuevo
#   2. Verifica tipos y compila (pnpm typecheck && pnpm build)
#   3. Actualiza la versión en package.json y la etiqueta del README
#   4. Commit "📦 chore: bump version to X.Y.Z" y push a main
#   5. Crea y sube el tag vX.Y.Z
#   6. Publica la release en GitHub con las notas generadas de los
#      commits ✨ feat / 🐛 fix desde el tag anterior
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="JulioCesarPreciado/odoo-remember"

# ── Validaciones ──────────────────────────────────────────────────
if [ $# -ne 1 ]; then
  echo "❌  Uso: ./release.sh <versión>   (ej. ./release.sh 1.1.0)"
  exit 1
fi

VERSION="$1"
TAG="v$VERSION"

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "❌  La versión debe tener formato X.Y.Z (recibido: $VERSION)"
  exit 1
fi

if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
  echo "❌  Debes estar en la rama main. Rama actual: $(git rev-parse --abbrev-ref HEAD)"
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌  Hay cambios sin commitear. Haz commit antes de crear la release."
  exit 1
fi

command -v gh &>/dev/null || { echo "❌  'gh' no está instalado: brew install gh"; exit 1; }

git fetch --tags --quiet origin
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "❌  El tag $TAG ya existe."
  exit 1
fi

# ── Notas de release (solo feat y fix) ────────────────────────────
PREV_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"
RANGE="${PREV_TAG:+$PREV_TAG..}HEAD"

# "✨ feat: add X" → "- Add X"
section() {
  local items
  items="$(git log --no-merges --pretty=format:'%s' "$RANGE" \
    | grep -E "^[^[:alnum:]]*[[:space:]]*$1:" \
    | sed -E "s/^[^[:alnum:]]*[[:space:]]*$1:[[:space:]]*//" \
    | awk '{ print "- " toupper(substr($0,1,1)) substr($0,2) }' || true)"
  if [ -n "$items" ]; then echo "$items"; else echo "$2"; fi
}

NOTES="## ✨ What's Changed

$(section feat "No new features.")

## 🐛 Bug Fixes

$(section fix "No bug fixes.")"

echo ""
echo "🚀  Release $TAG de odoo-remember${PREV_TAG:+ (desde $PREV_TAG)}"
echo ""
echo "$NOTES"
echo ""
read -r -p "¿Publicar? [s/N] " ok
[[ "$ok" =~ ^[sSyY]$ ]] || { echo "Cancelado."; exit 1; }

# ── 1. Verificar y compilar ───────────────────────────────────────
echo "🔨  Instalando dependencias y compilando…"
pnpm install --frozen-lockfile --silent
pnpm typecheck
pnpm build

# ── 2. Versión en package.json y README ───────────────────────────
echo "📝  Versión → $VERSION"
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '$VERSION';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  let readme = fs.readFileSync('README.md', 'utf8');
  const badge = '[![Version](https://img.shields.io/badge/version-$VERSION-blue.svg)](https://github.com/$REPO/releases)';
  readme = /badge\/version-[0-9.]+-blue/.test(readme)
    ? readme.replace(/badge\/version-[0-9.]+-blue/, 'badge/version-$VERSION-blue')
    : readme.replace('[![License]', badge + ' [![License]');   // primera release
  fs.writeFileSync('README.md', readme);
"

# ── 3. Commit de versión ──────────────────────────────────────────
git add package.json README.md
git commit -m "📦 chore: bump version to $VERSION"
git push origin main

# ── 4. Tag ────────────────────────────────────────────────────────
echo "🏷️   Tag ${TAG}…"
git tag -a "$TAG" -m "Version $VERSION"
git push origin "$TAG"

# ── 5. GitHub Release ─────────────────────────────────────────────
echo "📋  Publicando release en GitHub…"
gh release create "$TAG" --repo "$REPO" --title "Version $VERSION" --notes "$NOTES" --latest --verify-tag

echo ""
echo "✅  odoo-remember $TAG publicado."
echo "    👉  https://github.com/$REPO/releases/tag/$TAG"
echo "    Recuerda llevar main de regreso a develop y staging (shared/BRANCHES.MD)."

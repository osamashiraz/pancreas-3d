#!/usr/bin/env bash
# Copy the human pancreas module into a MouseBio_3D checkout and run its checks.
# Usage: bash scripts/install_into_mousebio.sh /path/to/MouseBio_3D
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"; REPO="${1:?path to MouseBio_3D checkout}"
cp -r "$HERE/repo/." "$REPO/"
cd "$REPO"
npx tsc --noEmit -p .
npx tsx --test tests/human-pancreas.test.ts
echo "Installed. Full suite: npm test"

#!/usr/bin/env bash
# Render resume/resume.html to PDF with headless Chrome.
#   scripts/build-resume.sh                 -> public/resume.pdf (web version, no phone)
#   PHONE='...' scripts/build-resume.sh OUT -> private version with phone, from ~/.config/wholden/resume.private.html (never commit it)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
chrome="${CHROME:-$(command -v google-chrome || command -v chromium)}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
if [[ -n "${PHONE:-}" ]]; then
  out="${1:?output path required for the private version}"
  # The full private resume lives outside this public repo.
  src="${RESUME_PRIVATE_SRC:-$HOME/.config/wholden/resume.private.html}"
  sed -e "s|{{PHONE}}|${PHONE}|" -e 's|<body>|<body class="private">|' "$src" > "$tmp/resume.html"
else
  out="$root/public/resume.pdf"
  cp "$root/resume/resume.html" "$tmp/resume.html"
fi
"$chrome" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$out" "file://$tmp/resume.html" 2>/dev/null
echo "wrote $out"

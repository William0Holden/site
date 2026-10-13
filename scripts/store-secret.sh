#!/usr/bin/env bash
# Prompt for a secret without echoing it and save it to ~/.config/wholden/secrets.env (mode 600,
# outside the repo). Usage: scripts/store-secret.sh OPENROUTER_API_KEY
set -euo pipefail
name="${1:?usage: store-secret.sh NAME}"
dir="$HOME/.config/wholden"; file="$dir/secrets.env"
umask 077; mkdir -p "$dir"; touch "$file"; chmod 600 "$file"
read -rsp "Paste $name (input hidden), then Enter: " value; echo
[[ -n "$value" ]] || { echo "empty, nothing saved"; exit 1; }
grep -v "^${name}=" "$file" > "$file.tmp" || true
printf '%s=%s\n' "$name" "$value" >> "$file.tmp"; mv "$file.tmp" "$file"; chmod 600 "$file"
unset value
echo "saved $name to $file"

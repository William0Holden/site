#!/usr/bin/env bash
# Print the friends-only unlock link (grants gated personal content in the chat for 90 days).
# Share it only with people you trust; rotate UNLOCK_SIGNING_SECRET to revoke every link.
set -euo pipefail
set -a; . "$HOME/.config/wholden/secrets.env"; set +a
code=$(printf '%s' 'unlock-link-v1' | openssl dgst -sha256 -hmac "$UNLOCK_SIGNING_SECRET" -binary | base64 | tr '+/' '-_' | tr -d '=')
echo "https://wholden.com/unlock#code=$code"

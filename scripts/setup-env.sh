#!/usr/bin/env bash
# Writes .env from .env.example, asking for the two R2 secrets.
# Typed values are not shown on screen and never leave this machine.
# Usage: bash scripts/setup-env.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  read -r -p ".env already exists. Overwrite it? [y/N] " answer
  [[ "$answer" == [yY] ]] || { echo "Left .env as it was."; exit 0; }
fi

read -r -s -p "R2_ACCESS_KEY_ID: " key_id; echo
read -r -s -p "R2_SECRET_ACCESS_KEY: " secret; echo
if [ -z "$key_id" ] || [ -z "$secret" ]; then
  echo "Both values are required, nothing written." >&2
  exit 1
fi

{
  grep -v -E '^(R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY)=' .env.example
  printf 'R2_ACCESS_KEY_ID=%s\nR2_SECRET_ACCESS_KEY=%s\n' "$key_id" "$secret"
} > .env
chmod 600 .env

if git check-ignore -q .env; then
  echo ".env written (git ignores it)."
else
  echo "WARNING: .env is NOT ignored by git, do not commit it." >&2
fi

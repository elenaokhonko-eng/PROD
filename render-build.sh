#!/usr/bin/env bash
set -euo pipefail

# Ensure the correct package manager shim is available before installing deps.
if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@10.18.3 --activate
fi

pnpm install --frozen-lockfile
pnpm run build

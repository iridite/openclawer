#!/bin/bash

set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${TEST_DIR}/.." && pwd)"
UI_DIR="${PROJECT_ROOT}/app/ui/assets"
MAIN_ENTRY="${UI_DIR}/management.js"
API_ENTRY="${UI_DIR}/management.api.js"

if [ ! -f "${MAIN_ENTRY}" ]; then
  echo "[frontend-request-entry] missing main entry: ${MAIN_ENTRY}"
  exit 1
fi

raw_fetch_hits="$(
  rg -n "fetch\\(" "${UI_DIR}" \
    -g '!management.js' \
    -g '!management.api.js' \
    -g '!vendor/**' \
    || true
)"

if [ -n "${raw_fetch_hits}" ]; then
  echo "[frontend-request-entry] found direct fetch usage outside allowed API entry files"
  echo "${raw_fetch_hits}"
  exit 1
fi

if [ ! -f "${API_ENTRY}" ]; then
  echo "[frontend-request-entry] missing API entry: ${API_ENTRY}"
  exit 1
fi

if ! rg -q "fetch\\(" "${API_ENTRY}"; then
  echo "[frontend-request-entry] API entry does not contain fetch usage"
  exit 1
fi

xhr_hits="$(
  rg -n "XMLHttpRequest|navigator\\.sendBeacon" "${UI_DIR}" \
    -g '!vendor/**' \
    || true
)"

if [ -n "${xhr_hits}" ]; then
  echo "[frontend-request-entry] found alternate request API usage"
  echo "${xhr_hits}"
  exit 1
fi

if ! rg -q "async function apiRequest" "${MAIN_ENTRY}"; then
  echo "[frontend-request-entry] apiRequest helper not found"
  exit 1
fi

if ! rg -q "async function apiFormRequest" "${MAIN_ENTRY}"; then
  echo "[frontend-request-entry] apiFormRequest helper not found"
  exit 1
fi

if ! rg -q "async function apiDownloadRequest" "${MAIN_ENTRY}"; then
  echo "[frontend-request-entry] apiDownloadRequest helper not found"
  exit 1
fi

echo "[frontend-request-entry] all checks passed"

#!/bin/bash

set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${TEST_DIR}/.." && pwd)"
TMP_DIR="$(mktemp -d /tmp/oc-deploy-backup-boundary-XXXXXX)"

export TRIM_APPNAME="oc-deploy-backup-test"
export OC_HOME="${TMP_DIR}/oc-home"
export TRIM_PKGVAR="${TMP_DIR}/pkgvar"
export OC_DEPLOY_BACKUP_ROOT="${TMP_DIR}/backups"
export NODE_PATH="$(command -v node || true)"

# shellcheck source=cmd/lib/backup_specs.sh
source "${PROJECT_ROOT}/cmd/lib/backup_specs.sh"

cleanup() {
  rm -rf "${TMP_DIR}" || true
}
trap cleanup EXIT

create_sample_entry() {
  local spec_id="$1"
  local item_type="$2"
  local _rel="$3"
  local target_path="$4"

  if [ "${item_type}" = "file" ]; then
    mkdir -p "$(dirname "${target_path}")"
    printf '%s\n' "${spec_id}" > "${target_path}"
  else
    mkdir -p "${target_path}"
    printf '%s\n' "${spec_id}" > "${target_path}/.probe"
  fi
}

remove_sample_entry() {
  local _spec_id="$1"
  local item_type="$2"
  local _rel="$3"
  local target_path="$4"

  if [ "${item_type}" = "file" ]; then
    rm -f "${target_path}"
  else
    rm -rf "${target_path}"
  fi
}

assert_restored_entry() {
  local spec_id="$1"
  local item_type="$2"
  local _rel="$3"
  local target_path="$4"

  if [ "${item_type}" = "file" ]; then
    if [ ! -f "${target_path}" ]; then
      echo "[backup-boundary] missing restored file: ${target_path}"
      exit 1
    fi
    return
  fi

  if [ ! -f "${target_path}/.probe" ]; then
    echo "[backup-boundary] missing restored probe for ${spec_id}: ${target_path}/.probe"
    exit 1
  fi
}

each_backup_spec create_sample_entry

bash "${PROJECT_ROOT}/cmd/upgrade_init"

MARKER_FILE="${OC_DEPLOY_BACKUP_ROOT}/.upgrade_backup_path"
if [ ! -f "${MARKER_FILE}" ]; then
  echo "[backup-boundary] upgrade marker file not found"
  exit 1
fi

BACKUP_DIR="$(cat "${MARKER_FILE}")"
MANIFEST_FILE="${BACKUP_DIR}/manifest.tsv"

if [ ! -f "${MANIFEST_FILE}" ]; then
  echo "[backup-boundary] manifest file not found"
  exit 1
fi

expected_count="$(
  awk 'BEGIN { count = 0 } /^[[:space:]]*#/ { next } NF > 0 { count++ } END { print count }' \
    "${PROJECT_ROOT}/config/backup-path-specs.tsv"
)"
actual_count="$(
  awk 'BEGIN { count = 0 } /^[[:space:]]*#/ { next } NF > 0 { count++ } END { print count }' \
    "${MANIFEST_FILE}"
)"

if [ "${expected_count}" != "${actual_count}" ]; then
  echo "[backup-boundary] manifest count mismatch: expected ${expected_count}, got ${actual_count}"
  exit 1
fi

each_backup_spec remove_sample_entry
bash "${PROJECT_ROOT}/cmd/upgrade_callback"
each_backup_spec assert_restored_entry

echo "[backup-boundary] all checks passed"

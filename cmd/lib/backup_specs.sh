#!/bin/bash

set -euo pipefail

BACKUP_SPECS_FILE_DEFAULT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/config/backup-path-specs.tsv"
BACKUP_SPECS_FILE="${BACKUP_SPECS_FILE:-${BACKUP_SPECS_FILE_DEFAULT}}"

resolve_backup_template() {
    local template="$1"
    template="${template//'${OC_HOME}'/${OC_HOME}}"
    template="${template//'${TRIM_PKGVAR}'/${TRIM_PKGVAR}}"
    printf '%s\n' "${template}"
}

each_backup_spec() {
    local callback="$1"
    while IFS=$'\t' read -r spec_id spec_type backup_path target_template; do
        if [ -z "${spec_id}" ] || [[ "${spec_id}" == \#* ]]; then
            continue
        fi

        local resolved_target
        resolved_target="$(resolve_backup_template "${target_template}")"
        "${callback}" "${spec_id}" "${spec_type}" "${backup_path}" "${resolved_target}"
    done < "${BACKUP_SPECS_FILE}"
}

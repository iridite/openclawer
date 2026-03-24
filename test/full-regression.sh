#!/bin/bash

set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${TEST_DIR}/.." && pwd)"

run_case() {
  local name="$1"
  shift
  echo "[full-regression] >>> ${name}"
  "$@"
  echo "[full-regression] <<< ${name} OK"
}

cd "${PROJECT_ROOT}"

# 1) 脚本语法与关键路径注入检查
run_case "bash syntax check" bash -lc 'bash -n cmd/install_callback cmd/main cmd/install_init cmd/upgrade_init cmd/upgrade_callback'
run_case "path injection guards" bash -lc '
  grep -q "/etc/profile.d/openclaw.sh" cmd/install_callback
  grep -q "/etc/fish/conf.d" cmd/install_callback
  grep -q "LOCAL_BIN_DIR=\"/usr/local/bin\"" cmd/install_callback
  grep -q "\${LOCAL_BIN_DIR}/node" cmd/install_callback
  grep -q "\${LOCAL_BIN_DIR}/openclaw" cmd/install_callback
'

# 2) 管理面板核心链路
run_case "smoke" bash test/smoke.sh
run_case "capability regression" bash test/capability-regression.sh
run_case "access policy regression" bash test/access-policy-regression.sh
run_case "config version conflict" bash test/config-version-conflict.sh
run_case "frontend request entry" bash test/frontend-request-entry.sh
run_case "priority error semantics" bash test/priority-error-semantics.sh

# 3) 运维边界链路
run_case "backup boundary" bash test/backup-boundary.sh
run_case "backup import regression" bash test/backup-import-regression.sh

# 4) 插件/技能链路（本地）
run_case "skills install local" bash test/skills-install-local.sh

echo "[full-regression] all checks passed"

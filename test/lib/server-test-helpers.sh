#!/bin/bash

# Shared helpers for non-interactive integration tests.

find_free_port() {
  python - <<'PY'
import socket
s = socket.socket()
s.bind(("", 0))
print(s.getsockname()[1])
s.close()
PY
}

start_management_api() {
  local project_root="$1"
  local api_log="$2"
  node "${project_root}/app/server/management-api.js" > "${api_log}" 2>&1 &
  echo $!
}

stop_process_if_running() {
  local pid="${1:-}"
  if [ -n "${pid}" ]; then
    kill "${pid}" 2>/dev/null || true
  fi
}

wait_http_ready() {
  local url="$1"
  local label="$2"
  local api_log="$3"
  local max_attempts="$4"
  local interval_seconds="$5"
  local connect_timeout_seconds="$6"
  local max_time_seconds="$7"
  local ready=0

  for _ in $(seq 1 "${max_attempts}"); do
    if curl -fsS \
      --connect-timeout "${connect_timeout_seconds}" \
      --max-time "${max_time_seconds}" \
      "${url}" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep "${interval_seconds}"
  done

  if [ "${ready}" -ne 1 ]; then
    echo "[${label}] API 未启动，日志如下:"
    tail -n 50 "${api_log}" || true
    return 1
  fi

  echo "[${label}] API ready: ${url}"
}

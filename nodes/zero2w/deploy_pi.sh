#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-crowdpm@192.168.8.114}"
if [ "$#" -gt 0 ]; then
  shift
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLAYBOOK="${SCRIPT_DIR}/ansible/deploy.yml"

if ! command -v ansible-playbook >/dev/null 2>&1; then
  echo "ansible-playbook is required. Install Ansible on the deploy machine and rerun this script." >&2
  exit 1
fi

if [[ "${TARGET}" == *@* ]]; then
  ANSIBLE_USER="${TARGET%@*}"
  ANSIBLE_HOST="${TARGET#*@}"
else
  ANSIBLE_USER=""
  ANSIBLE_HOST="${TARGET}"
fi

INVENTORY="$(mktemp)"
trap 'rm -f "${INVENTORY}"' EXIT

{
  echo "[crowdpm_zero2w]"
  if [ -n "${ANSIBLE_USER}" ]; then
    printf 'target ansible_host=%s ansible_user=%s\n' "${ANSIBLE_HOST}" "${ANSIBLE_USER}"
  else
    printf 'target ansible_host=%s\n' "${ANSIBLE_HOST}"
  fi
} > "${INVENTORY}"

ANSIBLE_ARGS=()
if [ "${CROWDPM_ANSIBLE_NO_BECOME_PROMPT:-0}" != "1" ]; then
  ANSIBLE_ARGS+=(--ask-become-pass)
fi

ansible-playbook -i "${INVENTORY}" "${PLAYBOOK}" "${ANSIBLE_ARGS[@]}" "$@"
echo "Deployed to ${TARGET}"

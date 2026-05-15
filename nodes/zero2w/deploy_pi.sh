#!/usr/bin/env bash
set -euo pipefail

PI_HOST="${1:-crowdpm@192.168.8.114}"
ROOT_DIR="/opt/crowdpm-node"
APP_DIR="${ROOT_DIR}/app"
STATE_DIR="${ROOT_DIR}/state"
STAGING_DIR=".crowdpm-node-staging"

ssh "${PI_HOST}" "mkdir -p '${STAGING_DIR}'"
rsync -az --delete \
  --exclude '.git' \
  --exclude '__pycache__' \
  --exclude '.venv' \
  --exclude '.codex-tmp' \
  ./ "${PI_HOST}:${STAGING_DIR}/"

ssh "${PI_HOST}" "printf '%s\n' 'WDCogv8uimqDKaRjKRpWs7xi' | sudo -S mkdir -p '${APP_DIR}' '${STATE_DIR}' '${ROOT_DIR}/venv'"
ssh "${PI_HOST}" "printf '%s\n' 'WDCogv8uimqDKaRjKRpWs7xi' | sudo -S rsync -a --delete '${STAGING_DIR}/' '${APP_DIR}/'"
ssh "${PI_HOST}" "printf '%s\n' 'WDCogv8uimqDKaRjKRpWs7xi' | sudo -S apt-get install -y python3-venv python3-pip python3-dev build-essential iw"
ssh "${PI_HOST}" "printf '%s\n' 'WDCogv8uimqDKaRjKRpWs7xi' | sudo -S python3 -m venv '${ROOT_DIR}/venv'"
ssh "${PI_HOST}" "printf '%s\n' 'WDCogv8uimqDKaRjKRpWs7xi' | sudo -S '${ROOT_DIR}/venv/bin/pip' install --upgrade pip"
ssh "${PI_HOST}" "printf '%s\n' 'WDCogv8uimqDKaRjKRpWs7xi' | sudo -S '${ROOT_DIR}/venv/bin/pip' install -r '${APP_DIR}/requirements.txt'"
ssh "${PI_HOST}" "printf '%s\n' 'WDCogv8uimqDKaRjKRpWs7xi' | sudo -S cp '${APP_DIR}/systemd/crowdpm-node.service' /etc/systemd/system/crowdpm-node.service"
ssh "${PI_HOST}" "printf '%s\n' 'WDCogv8uimqDKaRjKRpWs7xi' | sudo -S systemctl daemon-reload"
ssh "${PI_HOST}" "printf '%s\n' 'WDCogv8uimqDKaRjKRpWs7xi' | sudo -S systemctl enable crowdpm-node.service"
ssh "${PI_HOST}" "printf '%s\n' 'WDCogv8uimqDKaRjKRpWs7xi' | sudo -S systemctl restart crowdpm-node.service"
echo "Deployed to ${PI_HOST}"

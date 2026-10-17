#!/usr/bin/env bash
# One-time setup of the Ascend CRM server: Oracle Cloud, Ubuntu 24.04 (ARM or AMD).
#   curl -fsSL https://raw.githubusercontent.com/dewil95/tutos1/main/deploy/oracle/setup-server.sh -o setup-server.sh
#   sudo bash setup-server.sh
# Installs Node 22, pnpm, cloudflared and Litestream, creates the "ascend" user, the data
# folder and the systemd services, then builds and starts the CRM. Safe to run again.
# No inbound port is opened: the site reaches the server through a Cloudflare Tunnel.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/dewil95/tutos1.git}"
BRANCH="${BRANCH:-main}"
APP_USER=ascend
APP_DIR=/opt/ascend-crm
DATA_DIR=/var/lib/ascend-crm
CONF_DIR=/etc/ascend-crm
LITESTREAM_VERSION=0.3.13

if [ "$(id -u)" -ne 0 ]; then
  echo "Run it with sudo: sudo bash setup-server.sh" >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive

echo "== System packages and automatic security updates"
apt-get update -q
apt-get install -y -q ca-certificates curl git build-essential python3 sqlite3 unattended-upgrades
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF

echo "== Node.js 22 and pnpm"
if ! node -v 2>/dev/null | grep -q '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
corepack enable

echo "== cloudflared (Cloudflare Tunnel)"
if ! command -v cloudflared >/dev/null; then
  install -d -m 755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -q
  apt-get install -y -q cloudflared
fi

echo "== Litestream (continuous database backup)"
if ! command -v litestream >/dev/null; then
  arch="$(dpkg --print-architecture)"
  curl -fsSL -o /tmp/litestream.deb \
    "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${arch}.deb"
  dpkg -i /tmp/litestream.deb
  rm -f /tmp/litestream.deb
fi

echo "== App user, folders and code"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$DATA_DIR"
install -d -o root -g "$APP_USER" -m 750 "$CONF_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
  runuser -u "$APP_USER" -- git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
if [ ! -f "$CONF_DIR/env" ]; then
  install -o root -g "$APP_USER" -m 640 "$APP_DIR/deploy/oracle/env.example" "$CONF_DIR/env"
  echo "   Created $CONF_DIR/env: fill it in (sudo nano $CONF_DIR/env)."
fi

echo "== Services"
install -m 644 "$APP_DIR/deploy/oracle/ascend-crm.service" /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/oracle/ascend-crm-tick.service" /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/oracle/ascend-crm-tick.timer" /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/oracle/litestream.yml" /etc/litestream.yml
install -d /etc/systemd/system/litestream.service.d
install -m 644 "$APP_DIR/deploy/oracle/litestream-env.conf" /etc/systemd/system/litestream.service.d/env.conf
systemctl daemon-reload
systemctl enable ascend-crm.service ascend-crm-tick.timer

echo "== First build and start"
BRANCH="$BRANCH" bash "$APP_DIR/deploy/oracle/update.sh"
systemctl start ascend-crm-tick.timer

cat <<'DONE'

Done. Next:
  1. Fill in the settings:          sudo nano /etc/ascend-crm/env
  2. Apply them:                    sudo systemctl restart ascend-crm
  3. Connect the Cloudflare Tunnel: sudo cloudflared service install <TUNNEL TOKEN>
  4. Turn on backups (after the backup settings are in the env file):
                                    sudo systemctl enable --now litestream
  5. Check:                         curl -s http://127.0.0.1:3000/api/health
DONE

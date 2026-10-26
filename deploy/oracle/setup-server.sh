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

# A fresh server runs its own updates for the first minutes and holds apt's lock; installers
# that hit the lock can fail quietly (Node's did, leaving Ubuntu's old Node 18), so wait first.
wait_for_apt() {
  command -v cloud-init >/dev/null && cloud-init status --wait >/dev/null 2>&1 || true
  local i=0
  while fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock >/dev/null 2>&1; do
    [ "$i" -eq 0 ] && echo "   Waiting for Ubuntu's own updates to finish..."
    i=$((i + 1))
    if [ "$i" -gt 180 ]; then
      echo "Ubuntu's updates are still running after 15 minutes. Run this script again later." >&2
      exit 1
    fi
    sleep 5
  done
}

echo "== System packages and automatic security updates"
wait_for_apt
apt-get update -q
apt-get install -y -q ca-certificates curl git build-essential python3 sqlite3 unattended-upgrades
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF

echo "== Swap (2 GB): lets the CRM build on a small server"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== Node.js 22 and pnpm"
if ! node -v 2>/dev/null | grep -q '^v22\.'; then
  wait_for_apt
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  wait_for_apt
  apt-get install -y -q nodejs
fi
if ! node -v 2>/dev/null | grep -q '^v22\.'; then
  echo "Node.js 22 did not install (found $(node -v 2>/dev/null || echo none)). Run this script again." >&2
  exit 1
fi
corepack enable

echo "== cloudflared (Cloudflare Tunnel)"
if ! command -v cloudflared >/dev/null; then
  install -d -m 755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
    > /etc/apt/sources.list.d/cloudflared.list
  wait_for_apt
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
for unit in ascend-crm-usage.service ascend-crm-usage.timer ascend-crm-nightly.service ascend-crm-nightly.timer; do
  install -m 644 "$APP_DIR/deploy/oracle/$unit" /etc/systemd/system/
done
install -m 644 "$APP_DIR/deploy/oracle/litestream.yml" /etc/litestream.yml
install -d /etc/systemd/system/litestream.service.d
install -m 644 "$APP_DIR/deploy/oracle/litestream-env.conf" /etc/systemd/system/litestream.service.d/env.conf
systemctl daemon-reload
systemctl enable ascend-crm.service ascend-crm-tick.timer ascend-crm-usage.timer
systemctl start ascend-crm-usage.timer

echo "== First build and start"
BRANCH="$BRANCH" bash "$APP_DIR/deploy/oracle/update.sh"
systemctl start ascend-crm-tick.timer

cat <<'DONE'

Done. Next:
  1. Fill in the settings:          sudo nano /etc/ascend-crm/env
  2. Apply them:                    sudo systemctl restart ascend-crm
  3. Connect the Cloudflare Tunnel: sudo cloudflared service install <TUNNEL TOKEN>
  4. Turn on backups and the nightly restore check (after the backup settings are in the env file):
                                    sudo systemctl enable --now litestream ascend-crm-nightly.timer
  5. Check:                         curl -s http://127.0.0.1:3000/api/health
DONE

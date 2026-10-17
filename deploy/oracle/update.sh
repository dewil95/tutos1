#!/usr/bin/env bash
# Builds the latest code and restarts the CRM. Run any time: sudo bash update.sh
# (GitHub's "Deploy to Oracle" workflow runs it after each merge to main.)
set -euo pipefail

APP_USER=ascend
APP_DIR="${APP_DIR:-/opt/ascend-crm}"
BRANCH="${BRANCH:-main}"
DATABASE_PATH="${DATABASE_PATH:-/var/lib/ascend-crm/crm.db}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run it with sudo: sudo bash update.sh" >&2
  exit 1
fi

# COREPACK_ENABLE_DOWNLOAD_PROMPT=0: corepack fetches the pinned pnpm without asking.
as_app() {
  runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$@"
}

echo "== Code ($BRANCH)"
as_app git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
as_app git -C "$APP_DIR" checkout --quiet "$BRANCH"
# The server never has its own changes: always match GitHub exactly.
as_app git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH"

echo "== Build"
cd "$APP_DIR"
as_app pnpm install --frozen-lockfile
as_app pnpm --filter @mca/web build
standalone="$APP_DIR/apps/web/.next/standalone/apps/web"
as_app rm -rf "$standalone/.next/static"
as_app cp -r "$APP_DIR/apps/web/.next/static" "$standalone/.next/static"
if [ -d "$APP_DIR/apps/web/public" ]; then
  as_app cp -r "$APP_DIR/apps/web/public" "$standalone/public"
fi

echo "== Database"
as_app env DATABASE_PATH="$DATABASE_PATH" pnpm db:migrate

echo "== Restart"
systemctl restart ascend-crm
for _ in $(seq 1 30); do
  # 200 = everything set up; 503 = running but some settings still missing.
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true)"
  if [ "$code" = 200 ] || [ "$code" = 503 ]; then
    echo "CRM is running (health $code)."
    exit 0
  fi
  sleep 2
done
echo "The CRM did not start. See: sudo journalctl -u ascend-crm -n 50" >&2
exit 1

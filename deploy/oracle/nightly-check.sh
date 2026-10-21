#!/usr/bin/env bash
# Nightly work (ascend-crm-nightly.timer): proves the backup can be restored and is intact,
# and lets SQLite tidy its statistics. Writes one JSON line per run to backup-check.log.
set -uo pipefail
DATA_DIR="${DATA_DIR:-/var/lib/ascend-crm}"
DB="$DATA_DIR/crm.db"
OUT="$DATA_DIR/backup-check.log"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
sqlite3 "$DB" "PRAGMA optimize;" >/dev/null 2>&1 || true

if ! litestream restore -config /etc/litestream.yml -o "$tmp/restored.db" "$DB" >"$tmp/restore.txt" 2>&1; then
  detail="$(tail -n 1 "$tmp/restore.txt" | tr -d '\042\134')"
  printf '{"at":"%s","ok":false,"detail":"restore failed: %s"}\n' "$now" "$detail" >> "$OUT"
  exit 1
fi
check="$(sqlite3 "$tmp/restored.db" "PRAGMA integrity_check;" 2>&1 | head -n 1 | tr -d '\042\134')"
deals="$(sqlite3 "$tmp/restored.db" 'SELECT count(*) FROM "Deal";' 2>/dev/null || echo "?")"
live="$(sqlite3 "$DB" 'SELECT count(*) FROM "Deal";' 2>/dev/null || echo "?")"
ok=false
[ "$check" = "ok" ] && ok=true
printf '{"at":"%s","ok":%s,"detail":"integrity %s; deals in backup %s, live %s"}\n' \
  "$now" "$ok" "$check" "$deals" "$live" >> "$OUT"
tail -n 60 "$OUT" > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
[ "$ok" = true ]

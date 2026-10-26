#!/usr/bin/env bash
# Puts the CRM on its own address with HTTPS, without a domain on Cloudflare:
#   sudo bash /opt/ascend-crm/deploy/oracle/public-https.sh ascendcrm.duckdns.org
# Installs Caddy (gets and renews a free Let's Encrypt certificate by itself) in front of the CRM,
# opens ports 80 and 443 in Ubuntu's firewall, keeps the DuckDNS address pointed at this server,
# and switches the CRM to its own "Sign in with Google". Safe to run again.
# Also open 80 and 443 in Oracle: Networking → Virtual cloud networks → the subnet's security list.
set -euo pipefail

DOMAIN="${1:-}"
ENV_FILE=/etc/ascend-crm/env
DUCKDNS_TOKEN_FILE=/etc/ascend-crm/duckdns-token

if [ "$(id -u)" -ne 0 ]; then
  echo "Run it with sudo: sudo bash public-https.sh <address>" >&2
  exit 1
fi
if ! [[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  echo "Give the address, e.g.: sudo bash public-https.sh ascendcrm.duckdns.org" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE is missing: run setup-server.sh first." >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive

echo "== DuckDNS: keep $DOMAIN pointed at this server"
if [[ "$DOMAIN" == *.duckdns.org ]]; then
  if [ ! -s "$DUCKDNS_TOKEN_FILE" ]; then
    # Read without echo so the token never shows on screen or in the shell history.
    read -r -s -p "Paste your DuckDNS token (duckdns.org, top of the page), then Enter: " token
    echo
    install -m 600 /dev/null "$DUCKDNS_TOKEN_FILE"
    printf '%s' "$token" > "$DUCKDNS_TOKEN_FILE"
  fi
  cat > /usr/local/bin/ascend-duckdns <<SCRIPT
#!/usr/bin/env bash
# Tells DuckDNS this server's current public address (the token goes through stdin, not argv).
set -euo pipefail
token="\$(cat $DUCKDNS_TOKEN_FILE)"
printf 'url = "https://www.duckdns.org/update?domains=${DOMAIN%%.duckdns.org}&token=%s&ip="\n' "\$token" \\
  | curl -fsS -m 30 -K - | grep -qx OK
SCRIPT
  chmod 700 /usr/local/bin/ascend-duckdns
  cat > /etc/systemd/system/ascend-duckdns.service <<'UNIT'
[Unit]
Description=Keep the CRM's DuckDNS address pointed at this server
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/ascend-duckdns
UNIT
  cat > /etc/systemd/system/ascend-duckdns.timer <<'UNIT'
[Unit]
Description=Update the DuckDNS address every 10 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=10min

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  if ! /usr/local/bin/ascend-duckdns; then
    rm -f "$DUCKDNS_TOKEN_FILE"
    echo "DuckDNS didn't accept the update: check the token and the address, then run again." >&2
    exit 1
  fi
  systemctl enable --now ascend-duckdns.timer
fi

echo "== Firewall: allow 80 (certificate check) and 443 (the site)"
apt-get install -y -q iptables-persistent >/dev/null
for port in 443 80; do
  rule=(-p tcp --dport "$port" -m state --state NEW -j ACCEPT)
  iptables -C INPUT "${rule[@]}" 2>/dev/null && continue
  # Oracle's Ubuntu image ends INPUT with a REJECT rule, so the new rule goes ahead of it.
  reject="$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')"
  if [ -n "$reject" ]; then
    iptables -I INPUT "$reject" "${rule[@]}"
  else
    iptables -A INPUT "${rule[@]}"
  fi
done
netfilter-persistent save >/dev/null

echo "== Caddy (HTTPS in front of the CRM)"
if ! command -v caddy >/dev/null; then
  apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
    gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi
cat > /etc/caddy/Caddyfile <<CADDY
# Written by public-https.sh. Caddy gets and renews the HTTPS certificate on its own.
$DOMAIN {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		X-Frame-Options DENY
		Referrer-Policy strict-origin-when-cross-origin
		-Server
	}
	# Only the server's own timers use these; nobody outside needs them.
	@internal path /api/cron/* /api/health
	respond @internal 404
	reverse_proxy 127.0.0.1:3000
}
CADDY
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null
systemctl reload-or-restart caddy

echo "== CRM settings: address and its own sign-in"
set_env() {
  if grep -q "^$1=" "$ENV_FILE"; then
    sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
}
set_env APP_URL "https://$DOMAIN"
if ! grep -q '^SESSION_SECRET=.\{32,\}' "$ENV_FILE"; then
  set_env SESSION_SECRET "$(openssl rand -hex 32)"
fi
systemctl restart ascend-crm

echo "== Check"
ok=""
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null -m 10 "https://$DOMAIN/login"; then
    ok=1
    break
  fi
  sleep 5
done
if [ -z "$ok" ]; then
  cat >&2 <<'HELP'
https://... doesn't answer yet. Usually one of:
  - Oracle's security list doesn't allow ports 80 and 443 yet (see the top of this script).
  - The DuckDNS address doesn't point at this server yet: wait a minute and run again.
Caddy's log: sudo journalctl -u caddy -n 50
HELP
  exit 1
fi

cat <<DONE

The CRM answers at https://$DOMAIN
Last step, in Google Cloud → APIs & Services → Credentials → the CRM's OAuth client, add:
  Authorized JavaScript origin:  https://$DOMAIN
  Authorized redirect URIs:      https://$DOMAIN/api/auth/callback
                                 https://$DOMAIN/api/google/callback
Then open https://$DOMAIN and sign in with Google.
DONE

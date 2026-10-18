#!/usr/bin/env bash
# Records the server's CPU and memory use once a minute (run by ascend-crm-usage.timer), the
# way Oracle judges "idle" Always Free servers: 7 days of CPU (95th percentile) and memory.
# Keeps the last 7 days in /var/lib/ascend-crm/usage.log as "epoch cpu% mem%" lines.
set -euo pipefail
DATA_DIR="${DATA_DIR:-/var/lib/ascend-crm}"
LOG="$DATA_DIR/usage.log"
PREV="$DATA_DIR/usage.prev"

# CPU: busy share since the previous sample, from the kernel's cumulative counters.
read -r _ user nice system idle iowait irq softirq steal _ < /proc/stat
total=$((user + nice + system + idle + iowait + irq + softirq + steal))
busy=$((total - idle - iowait))
cpu=0
if [ -f "$PREV" ]; then
  read -r ptotal pbusy < "$PREV"
  dt=$((total - ptotal))
  if [ "$dt" -gt 0 ]; then cpu=$(((busy - pbusy) * 1000 / dt)); fi
fi
echo "$total $busy" > "$PREV"

# Memory: in use = total minus what the kernel says is available (cache doesn't count).
mem=$(awk '/^MemTotal:/ {t=$2} /^MemAvailable:/ {a=$2} END {printf "%d", (t - a) * 1000 / t}' /proc/meminfo)

printf '%s %s.%s %s.%s\n' "$(date +%s)" "$((cpu / 10))" "$((cpu % 10))" "$((mem / 10))" "$((mem % 10))" >> "$LOG"
# 7 days of one-minute samples.
tail -n 10080 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"

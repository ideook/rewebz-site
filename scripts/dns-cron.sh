#!/bin/zsh
set -e
cd /Users/dukhyunlee/.openclaw/workspace-saas-projects/rewebz-site
mkdir -p logs
if [ -f .env.worker ]; then
  set -a
  source .env.worker
  set +a
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
echo "[$(date '+%F %T %Z')] dns-cron tick" >> logs/dns-cron.log
./scripts/run-worker.sh >> logs/dns-cron.log 2>&1

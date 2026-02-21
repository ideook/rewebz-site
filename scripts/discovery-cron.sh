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

echo "[$(date '+%F %T %Z')] discovery-cron tick" >> logs/discovery-cron.log
node scripts/discovery-engine.js >> logs/discovery-cron.log 2>&1

#!/bin/zsh
set -e
cd /Users/dukhyunlee/.openclaw/workspace/rewebz-site
mkdir -p logs
if [ -f .env.worker ]; then
  set -a
  source .env.worker
  set +a
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
echo "[$(date '+%F %T %Z')] open-cron tick" >> logs/open-cron.log
node scripts/live-verify.js >> logs/open-cron.log 2>&1

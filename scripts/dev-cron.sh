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
echo "[$(date '+%F %T %Z')] dev-cron tick" >> logs/dev-cron.log
node scripts/dev-build.js >> logs/dev-cron.log 2>&1

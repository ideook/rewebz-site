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

echo "[$(date '+%F %T %Z')] design-cron tick" >> logs/design-cron.log
node scripts/design-plan.js >> logs/design-cron.log 2>&1

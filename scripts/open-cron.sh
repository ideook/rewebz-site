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
echo "[$(date '+%F %T %Z')] open-cron tick" >> logs/open-cron.log
if [ "${R2_ENABLED:-0}" = "1" ]; then
  echo "[$(date '+%F %T %Z')] skip:deploy-site (r2-enabled)" >> logs/open-cron.log
else
  node scripts/deploy-site.js >> logs/open-cron.log 2>&1 || echo "[$(date '+%F %T %Z')] step_fail:deploy-site" >> logs/open-cron.log
fi
node scripts/live-verify.js >> logs/open-cron.log 2>&1

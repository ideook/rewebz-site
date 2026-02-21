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

echo "[$(date '+%F %T %Z')] promote-cron tick" >> logs/promote-cron.log

if [ -z "${PROMOTE_SLUG:-}" ]; then
  echo "[$(date '+%F %T %Z')] skip: PROMOTE_SLUG not set" >> logs/promote-cron.log
  exit 0
fi

node scripts/promote-site.js --slug "$PROMOTE_SLUG" ${PROMOTE_ARGS:-} >> logs/promote-cron.log 2>&1

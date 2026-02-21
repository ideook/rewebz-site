#!/bin/zsh
set -e
cd /Users/dukhyunlee/.openclaw/workspace-saas-projects/rewebz-site

if [ -f .env.worker ]; then
  set -a
  source .env.worker
  set +a
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# gate to every 5 minutes even if cron is every minute
MIN=$(date +%M)
if [ $((10#$MIN % 5)) -ne 0 ]; then
  exit 0
fi

node scripts/lead-worker.js >> /Users/dukhyunlee/.openclaw/workspace-saas-projects/rewebz-site/logs/worker.log 2>&1

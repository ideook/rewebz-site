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

mkdir -p logs

echo "[$(date '+%F %T %Z')] run-worker tick" >> logs/worker.log

# stage 0: discovery request -> candidates
./scripts/discovery-cron.sh >> logs/worker.log 2>&1 || echo "[$(date '+%F %T %Z')] step_fail:discovery-cron" >> logs/worker.log

# stage 1: apply request -> DNS_DONE
node scripts/lead-worker.js >> logs/worker.log 2>&1

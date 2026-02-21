#!/bin/zsh
set -e
cd /Users/dukhyunlee/.openclaw/workspace/rewebz-site
mkdir -p logs sites

echo "[$(date '+%F %T %Z')] staged-runner tick" >> logs/autobuild.log

if [ -f .env.worker ]; then
  set -a
  source .env.worker
  set +a
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# run only on 5-minute boundaries
MIN=$(date +%M)
if [ $((10#$MIN % 5)) -ne 0 ]; then
  exit 0
fi

# Stage 2: DNS_DONE -> DESIGN_DONE (t+0m)
./scripts/design-cron.sh >> logs/autobuild.log 2>&1 || echo "[$(date '+%F %T %Z')] step_fail:design-cron" >> logs/autobuild.log

# Stage 3: DESIGN_DONE -> DEV_DONE (t+1m)
sleep 60
./scripts/dev-cron.sh >> logs/autobuild.log 2>&1 || echo "[$(date '+%F %T %Z')] step_fail:dev-cron" >> logs/autobuild.log

# Stage 4: DEV_DONE -> OPEN_DONE (t+2m)
sleep 60
./scripts/open-cron.sh >> logs/autobuild.log 2>&1 || echo "[$(date '+%F %T %Z')] step_fail:open-cron" >> logs/autobuild.log

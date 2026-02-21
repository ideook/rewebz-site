#!/bin/zsh
set -e
cd /Users/dukhyunlee/.openclaw/workspace/rewebz-site
mkdir -p logs sites

echo "[$(date '+%F %T %Z')] design-runner tick" >> logs/autobuild.log

if [ -f .env.worker ]; then
  set -a
  source .env.worker
  set +a
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Stage 2: DNS_DONE -> DESIGN_DONE
node scripts/design-plan.js >> logs/autobuild.log 2>&1 || echo "[$(date '+%F %T %Z')] step_fail:design-plan" >> logs/autobuild.log

# Stage 3: DESIGN_DONE -> DEV_DONE
node scripts/dev-build.js >> logs/autobuild.log 2>&1 || echo "[$(date '+%F %T %Z')] step_fail:dev-build" >> logs/autobuild.log

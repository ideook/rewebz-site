#!/bin/zsh
set -e
cd /Users/dukhyunlee/.openclaw/workspace/rewebz-site
mkdir -p logs sites

echo "[$(date '+%F %T %Z')] tick: autobuild runner" >> logs/autobuild.log

if [ -f .env.worker ]; then
  set -a
  source .env.worker
  set +a
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# lightweight health/progress checkpoint
if [ -f scripts/lead-worker.js ]; then
  echo "[$(date '+%F %T %Z')] worker:present" >> logs/autobuild.log
fi

# pipeline steps
for f in scripts/generate-site.js scripts/qa-site.js scripts/deploy-site.js; do
  if [ ! -f "$f" ]; then
    echo "[$(date '+%F %T %Z')] missing:$f" >> logs/autobuild.log
    continue
  fi

  if [ "$f" = "scripts/qa-site.js" ]; then
    node "$f" >> logs/autobuild.log 2>&1 || echo "[$(date '+%F %T %Z')] qa_warn:$f" >> logs/autobuild.log
  else
    node "$f" >> logs/autobuild.log 2>&1 || echo "[$(date '+%F %T %Z')] step_fail:$f" >> logs/autobuild.log
  fi

done

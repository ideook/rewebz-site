#!/bin/zsh
set -e
cd /Users/dukhyunlee/.openclaw/workspace/rewebz-site

if [ -f .env.worker ]; then
  set -a
  source .env.worker
  set +a
fi

/usr/bin/env node scripts/lead-worker.js >> /Users/dukhyunlee/.openclaw/workspace/rewebz-site/logs/worker.log 2>&1

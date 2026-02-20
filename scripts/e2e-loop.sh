#!/bin/zsh
set -e

ROOT="/Users/dukhyunlee/.openclaw/workspace/rewebz-site"
cd "$ROOT"
mkdir -p logs

if [ -f .env.worker ]; then
  set -a
  source .env.worker
  set +a
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

TS=$(date +%s)
EMAIL="rewebz.e2e.${TS}@example.com"
BUSINESS="E2E 자동검증 ${TS}"

echo "[$(date '+%F %T %Z')] E2E start ts=$TS" >> logs/e2e-loop.log

RESP=$(curl -sS -X POST https://www.rewebz.com/api/apply \
  -H 'content-type: application/json' \
  --data "{\"business_name\":\"${BUSINESS}\",\"website_url\":\"https://example.com\",\"contact_name\":\"E2E\",\"contact_email\":\"${EMAIL}\",\"contact_phone\":\"010-0000-0000\",\"category\":\"서비스업\",\"region\":\"서울\",\"goal\":\"문의 전환율 개선\",\"notes\":\"e2e-loop\"}")

REQ_ID=$(python3 - "$RESP" <<'PY'
import json,sys
try:
  d=json.loads(sys.argv[1]);print(d.get('requestId',''))
except Exception:
  print('')
PY
)

if [ -z "$REQ_ID" ]; then
  echo "[$(date '+%F %T %Z')] E2E fail: apply response invalid: $RESP" >> logs/e2e-loop.log
  exit 1
fi

echo "[$(date '+%F %T %Z')] requestId=$REQ_ID" >> logs/e2e-loop.log

# process pipeline
echo "[$(date '+%F %T %Z')] run worker" >> logs/e2e-loop.log
./scripts/run-worker.sh || true

# regenerate per-site source + QA + deploy bookkeeping
./scripts/autobuild-runner.sh || true

# fetch row status/slug from sheet (node)
ROW=""
for n in 1 2 3 4 5 6; do
  ROW=$(node - "$REQ_ID" <<'NODE'
const { google } = require('googleapis');
(async()=>{
  const reqId = process.argv[2];
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY||'').replace(/\\n/g,'\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  const sheets = google.sheets({version:'v4', auth});
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: process.env.GOOGLE_SHEET_RANGE || '시트1!A:N' });
  const rows = res.data.values || [];
  const row = rows.slice(1).find(r => (r[0]||'') === reqId);
  if (!row) { console.log('row_not_found'); return; }
  const status = row[2] || '';
  const slug = row[12] || '';
  const url = row[13] || '';
  console.log(`status=${status} slug=${slug} url=${url}`);
})();
NODE
)
  if [[ "$ROW" != "row_not_found" ]]; then
    break
  fi
  sleep 5
done

echo "$ROW" >> logs/e2e-loop.log
SLUG=$(echo "$ROW" | sed -n 's/.*slug=\([^ ]*\).*/\1/p')

if [ -z "$SLUG" ]; then
  echo "[$(date '+%F %T %Z')] E2E fail: no slug" >> logs/e2e-loop.log
  exit 1
fi

# verify tenant source API and page
TENANT_API=$(curl -sS "https://${SLUG}.rewebz.com/api/sitehtml" || true)
if ! echo "$TENANT_API" | grep -q '"ok":true'; then
  echo "[$(date '+%F %T %Z')] E2E warn: tenant api not ready for $SLUG" >> logs/e2e-loop.log
fi

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${SLUG}.rewebz.com" || true)
echo "[$(date '+%F %T %Z')] tenant_http=${HTTP_CODE} slug=${SLUG}" >> logs/e2e-loop.log

# auto-heal trigger if failed
if [ "$HTTP_CODE" != "200" ]; then
  echo "[$(date '+%F %T %Z')] heal: trigger vercel redeploy" >> logs/e2e-loop.log
  if [ -n "$VERCEL_TOKEN" ] && [ -n "$VERCEL_PROJECT_ID" ] && [ -n "$VERCEL_TEAM_SLUG" ]; then
    export VERCEL_ORG_ID=$(curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v2/teams/$VERCEL_TEAM_SLUG" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("id",""))')
    npx vercel --prod --yes --token "$VERCEL_TOKEN" >> logs/e2e-loop.log 2>&1 || true
  fi
fi

echo "[$(date '+%F %T %Z')] E2E done req=$REQ_ID slug=$SLUG" >> logs/e2e-loop.log

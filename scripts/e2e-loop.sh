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

# fetch row status/slug from sheet
python3 - <<'PY' "$REQ_ID" >> logs/e2e-loop.log
import os,sys,json
from google.oauth2 import service_account
from googleapiclient.discovery import build
req_id=sys.argv[1]
email=os.environ.get('GOOGLE_SERVICE_ACCOUNT_EMAIL')
key=(os.environ.get('GOOGLE_PRIVATE_KEY') or '').replace('\\n','\n')
sheet=os.environ.get('GOOGLE_SHEET_ID')
rng=os.environ.get('GOOGLE_SHEET_RANGE','시트1!A:N')
creds=service_account.Credentials.from_service_account_info({
  "type":"service_account",
  "client_email":email,
  "private_key":key,
  "token_uri":"https://oauth2.googleapis.com/token"
},scopes=['https://www.googleapis.com/auth/spreadsheets.readonly'])
svc=build('sheets','v4',credentials=creds,cache_discovery=False)
vals=svc.spreadsheets().values().get(spreadsheetId=sheet,range=rng).execute().get('values',[])
row=None
for r in vals[1:]:
  if len(r)>0 and r[0]==req_id:
    row=r;break
if not row:
  print('row_not_found')
  raise SystemExit(2)
status = row[2] if len(row)>2 else ''
slug = row[12] if len(row)>12 else ''
url = row[13] if len(row)>13 else ''
print(f'status={status} slug={slug} url={url}')
if not slug:
  raise SystemExit(3)
PY

SLUG=$(tail -n 1 logs/e2e-loop.log | sed -n 's/.*slug=\([^ ]*\).*/\1/p')

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

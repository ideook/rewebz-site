# rewebz-site

Minimal starter page for deploying `rewebz.com` on Vercel.

## 1) Create GitHub repo

Create a new repo (example): `rewebz-site`

## 2) Push this folder

```bash
cd /Users/dukhyunlee/.openclaw/workspace-saas-projects/rewebz-site
git init
git add .
git commit -m "init: rewebz landing page"
git branch -M main
git remote add origin https://github.com/<YOUR_ID>/rewebz-site.git
git push -u origin main
```

## 3) Import on Vercel

1. Go to Vercel dashboard
2. `Add New` → `Project`
3. Import `rewebz-site`
4. Framework preset: `Other` (static)
5. Deploy

## 4) Connect domain

In Vercel project settings:
- Add `rewebz.com`
- Add `www.rewebz.com`
- Add `*.rewebz.com` (wildcard)

Then set DNS in Cloudflare following Vercel instructions.

## 5) First test URLs

- `https://rewebz.com`
- `https://www.rewebz.com`
- `https://demo.rewebz.com` (after wildcard DNS)

---

## Apply form + Google Sheets integration

### Files added
- `apply/index.html` → apply form (`/apply`)
- `api/apply.js` → saves submissions to Google Sheets
- `package.json` → includes `googleapis`

### Required env vars (Vercel)

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY` (paste full key, keep `\n` line breaks)
- `GOOGLE_SHEET_ID` = `1yVpuef9SuR0rW1D0tAIMJIpsdRI47SWN-tG2gc8GRHA`
- `GOOGLE_SHEET_RANGE` = `시트1!A:N`
- `ROOT_DOMAIN` = `rewebz.com`

### Sheet header order (A:N)

`id, created_at, status, business_name, website_url, contact_name, contact_email, contact_phone, category, region, goal, notes, slug, mockup_url`

### Service account permission

Share the Google Sheet with the service account email as **Editor**.

---

## Discovery intake + research engine

- Intake page: `/discover`
- Intake API: `POST /api/discovery-intake`
- Engine script: `scripts/discovery-engine.js`
- Approval script: `scripts/discovery-approve.js`

### Discovery sheet columns (A:Q)

`request_id, created_at, stage, lat, lng, metric_m, category, title, notes, map_link, ref_id, website_url, phone, rating, reviews, score, source`

- Request row stage: `DISCOVERY_NEW -> DISCOVERY_COLLECTING -> DISCOVERY_DONE`
- Candidate row stage: `FOUND`
- Approval stage: `APPROVED_APPLIED`

### Required envs

- `GOOGLE_DISCOVERY_SHEET_ID`
- `GOOGLE_DISCOVERY_SHEET_RANGE` (default `Discovery!A2:Q`)
- `GOOGLE_PLACES_API_KEY` (or local fallback to `~/.openclaw/openclaw.json` goplaces key)

### Run commands

```bash
# process new discovery requests and collect candidates
npm run discovery:run

# approve one candidate and inject to main apply sheet
npm run discovery:approve -- --request-id rwzd_xxxx --rank 1
# or by place id
npm run discovery:approve -- --request-id rwzd_xxxx --place-id ChIJ...
```

`run-worker.sh` now runs discovery stage automatically every 5 minutes before lead processing.

---

## Preview -> Production Promotion

Use manual promotion when a preview tenant is approved.

```bash
node scripts/promote-site.js --slug lead-1234
# or by request id
node scripts/promote-site.js --id rwz_mlvwlddz_kvgy
# or by preview URL
node scripts/promote-site.js --url https://lead-1234.preview.rewebz.com
# or generic ref (slug/url/id)
node scripts/promote-site.js --ref lead-1234

# npm script alias
npm run promote -- --slug lead-1234
```

Optional flags:

- `--dry-run` (no mutation)
- `--timeoutSec 900`
- `--no-telegram`

Required env vars for promotion:

- `ROOT_DOMAIN` (default `rewebz.com`)
- `CF_TARGET_CNAME` (default `cname.vercel-dns.com`)
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`
- `VERCEL_TOKEN`, `VERCEL_PROJECT_ID` (`VERCEL_TEAM_SLUG` optional)

Sheet/Telegram integration is optional but recommended:

- Sheet: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_RANGE`
- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

---

## R2 storage migration (no redeploy per slug)

When `R2_ENABLED=1`, generated tenant HTML is uploaded to R2:

- `sites/{slug}/{version}/index.html`
- `sites/{slug}/_live.json` (live pointer)

`api/sitehtml` reads from R2 first, then falls back to local `sites/` for compatibility.

### Required R2 env vars

- `R2_ENABLED=1`
- `R2_ACCOUNT_ID`
- `R2_BUCKET`
- `R2_ENDPOINT` (`https://<account_id>.r2.cloudflarestorage.com`)
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_KEY_PREFIX` (default `sites`)

### Notes

- `LOCAL_SITE_WRITE=0` keeps local source dirs minimal after upload.
- `CLEAN_LOCAL_ON_R2=1` removes per-slug local dirs after successful DEV build.
- Promotion script supports slug / request id / preview URL.

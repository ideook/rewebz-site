# rewebz-site

Minimal starter page for deploying `rewebz.com` on Vercel.

## 1) Create GitHub repo

Create a new repo (example): `rewebz-site`

## 2) Push this folder

```bash
cd /Users/dukhyunlee/.openclaw/workspace/rewebz-site
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

## Preview -> Production Promotion

Use manual promotion when a preview tenant is approved.

```bash
node scripts/promote-site.js --slug lead-1234
# or
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

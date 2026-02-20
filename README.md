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

#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || '시트1!A:N';
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const BASE_DIR = path.resolve(__dirname, '..', 'sites');
const MAX_PER_RUN = Number(process.env.DEV_BUILD_MAX_PER_RUN || 1);
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'rewebz.com';
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || '';
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT || '';
const VERCEL_TEAM_SLUG = process.env.VERCEL_TEAM_SLUG || '';

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function checkLive(url, tries=5) {
  for (let i=0;i<tries;i++) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.status >= 200 && r.status < 400) return { ok:true, code:r.status };
    } catch (_) {}
    await sleep(3000);
  }
  return { ok:false, code:0 };
}

function extractHtml(text = '') {
  const t = String(text || '').trim();
  const fenced = t.match(/```html\s*([\s\S]*?)```/i) || t.match(/```\s*([\s\S]*?)```/i);
  const html = fenced ? fenced[1].trim() : t;
  if (!/^<!doctype html>|^<html/i.test(html)) return '';
  return html;
}

async function ensureVercelDomain(fqdn) {
  if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) return { ok: false, skipped: true };
  const url = `https://api.vercel.com/v10/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/domains?teamSlug=${encodeURIComponent(VERCEL_TEAM_SLUG)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: fqdn }),
  });
  const j = await r.json();
  if (r.ok) return { ok: true, created: true };
  if (r.status === 409 || /already|in use|exists/i.test(JSON.stringify(j))) return { ok: true, created: false };
  throw new Error(`vercel-domain-fail:${JSON.stringify(j).slice(0,200)}`);
}

function buildWithWebAgent(input) {
  const prompt = [
    'You are a frontend developer.',
    'Read the DESIGN_SPEC and build a complete single-file HTML page.',
    'Output only HTML (<!doctype html> ...).',
    'Korean copy, production-quality visual polish, responsive layout.',
    'No external JS libraries. Inline CSS only.',
    '',
    'Project input:',
    input,
  ].join('\n');

  const cmd = `openclaw agent --agent web --message ${JSON.stringify(prompt)} --json`;
  const raw = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = JSON.parse(raw);
  const text = parsed?.result?.payloads?.[0]?.text || '';
  return extractHtml(text);
}

async function main() {
  if (!SHEET_ID || !SA_EMAIL || !SA_KEY) throw new Error('Missing Google envs');
  const auth = new google.auth.JWT({ email: SA_EMAIL, key: SA_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: SHEET_RANGE });
  const rows = data.values || [];

  let processed = 0;
  for (let i = 1; i < rows.length; i++) {
    if (processed >= MAX_PER_RUN) break;
    const r = rows[i];
    const status = (r[2] || '').trim();
    if (status !== 'DESIGN_DONE') continue;

    const id = r[0] || '';
    const business = r[3] || '';
    const notes = r[11] || '';
    const slug = (r[12] || '').trim();
    if (!slug) continue;

    const siteDir = path.join(BASE_DIR, slug);
    const specPath = path.join(siteDir, 'DESIGN_SPEC.md');
    const indexPath = path.join(siteDir, 'index.html');
    if (!fs.existsSync(specPath)) continue;

    const spec = fs.readFileSync(specPath, 'utf8');

    let html = '';
    try {
      html = buildWithWebAgent([
        `requestId: ${id}`,
        `slug: ${slug}`,
        `business: ${business}`,
        '',
        spec,
      ].join('\n'));
    } catch (e) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: `시트1!C${i + 1}`, values: [['DEV_ERROR']] },
            { range: `시트1!L${i + 1}`, values: [[`${notes ? notes + ' | ' : ''}dev:error:${String(e.message).slice(0,120)}`]] },
          ],
        },
      });
      continue;
    }

    if (!html) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: `시트1!C${i + 1}`, values: [['DEV_ERROR']] },
            { range: `시트1!L${i + 1}`, values: [[`${notes ? notes + ' | ' : ''}dev:error:empty_html`]] },
          ],
        },
      });
      continue;
    }

    fs.writeFileSync(indexPath, html);
    const fqdn = `${slug}.${ROOT_DOMAIN}`;
    let domainNote = 'vercel:skipped';
    try {
      const vd = await ensureVercelDomain(fqdn);
      if (vd.ok) domainNote = vd.created ? 'vercel:created' : 'vercel:exists';
    } catch (e) {
      domainNote = `vercel:error`;
    }

    const liveUrl = `https://${fqdn}`;
    const live = await checkLive(liveUrl, 6);
    const finalStatus = live.ok ? 'LIVE' : 'DEV_DONE';

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `시트1!C${i + 1}`, values: [[finalStatus]] },
          { range: `시트1!L${i + 1}`, values: [[`${notes ? notes + ' | ' : ''}dev:done(gpt-5.3) | ${domainNote} | health:${live.code||0}`]] },
        ],
      },
    });

    processed++;
    console.log(`dev done for ${slug} (${finalStatus})`);
  }

  console.log(`dev-build done: ${processed}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

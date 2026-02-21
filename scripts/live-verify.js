#!/usr/bin/env node
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || '시트1!A:N';
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'rewebz.com';
const TENANT_ROOT_DOMAIN = process.env.TENANT_ROOT_DOMAIN || ROOT_DOMAIN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const BUILD_MARKER_NAME = 'rewebz-build-marker';
const { getR2Config, hasLiveSiteSource } = require('../lib/r2');
const R2 = getR2Config();

function markerContent(slug = '') {
  return `rwz-live-v2:${slug}`;
}

function escRe(s = '') {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasBuildMarker(html = '', slug = '') {
  const marker = markerContent(slug);
  const rx = new RegExp(
    `<meta[^>]*name=["']${escRe(BUILD_MARKER_NAME)}["'][^>]*content=["'][^"']*${escRe(marker)}[^"']*["'][^>]*>`,
    'i',
  );
  return rx.test(String(html || ''));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sh(cmd) {
  return execSync(cmd, {
    cwd: path.resolve(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  }).trim();
}

async function headOk(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.status >= 200 && r.status < 400) return r.status;
    } catch (_) {}
    await sleep(2500);
  }
  return 0;
}

async function tenantApiOk(hostname, slug, tries = 3) {
  const api = `https://${hostname}/api/sitehtml`;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(api, { method: 'GET', headers: { 'Cache-Control': 'no-cache' } });
      if (!r.ok) {
        await sleep(2500);
        continue;
      }
      const j = await r.json().catch(() => null);
      if (j?.ok && j?.kind === 'tenant' && (j?.slug || '').trim() === slug && /<html/i.test(j?.html || '')) {
        return { code: r.status, markerOk: hasBuildMarker(j?.html || '', slug) };
      }
    } catch (_) {}
    await sleep(2500);
  }
  return { code: 0, markerOk: false };
}

function existsOnOrigin(slug) {
  try {
    const file = `sites/${slug}/index.html`;
    const out = sh(`git ls-tree -r --name-only origin/main -- ${JSON.stringify(file)}`);
    return out.split('\n').map((x) => x.trim()).includes(file);
  } catch {
    return false;
  }
}

async function hasSourceAvailable(slug) {
  if (R2.enabled) {
    return hasLiveSiteSource(slug, R2);
  }
  return existsOnOrigin(slug);
}

function syncForLegacyMode() {
  // keep legacy/local mode self-sufficient: generate manifest + commit/push if needed
  try {
    execSync(`node ${JSON.stringify(path.join(__dirname, 'deploy-site.js'))}`, {
      cwd: path.resolve(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (_) {}

  try {
    sh('git fetch origin main --quiet');
  } catch (_) {}
}

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        disable_web_page_preview: true,
      }),
    });
  } catch (_) {}
}

async function main() {
  if (!SHEET_ID || !SA_EMAIL || !SA_KEY) throw new Error('Missing Google envs');

  if (!R2.enabled) {
    syncForLegacyMode();
  }

  const auth = new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: SHEET_RANGE });
  const rows = res.data.values || [];

  let done = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const id = r[0] || '';
    const status = (r[2] || '').trim();
    const business = r[3] || '';
    const notes = r[11] || '';
    const slug = (r[12] || '').trim();
    const url = (r[13] || '').trim();

    // transitional compatibility: old OPEN_DONE rows can be promoted to LIVE when checks pass.
    if (!['DEV_DONE', 'OPEN_DONE'].includes(status) || !slug || !url) continue;

    // hard gate 1: source exists in configured storage (R2 or legacy git)
    if (!await hasSourceAvailable(slug)) continue;

    let host = `${slug}.${TENANT_ROOT_DOMAIN}`;
    try { host = new URL(url).hostname || host; } catch (_) {}

    // hard gate 2: deployed runtime can read tenant source from /api/sitehtml
    const sitehtml = await tenantApiOk(host, slug, 3);
    if (!sitehtml.code || !sitehtml.markerOk) continue;

    // hard gate 3: tenant URL serves successfully
    const headCode = await headOk(url, 3);
    if (!headCode) continue;

    const sourceLabel = R2.enabled ? 'r2' : 'git:origin/main';

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `시트1!C${i + 1}`, values: [['LIVE']] },
          {
            range: `시트1!L${i + 1}`,
            values: [[`${notes ? notes + ' | ' : ''}live:verified(source:${sourceLabel},sitehtml:${sitehtml.code},marker:ok,head:${headCode})`]],
          },
        ],
      },
    });

    await sendTelegram([
      '✅ rewebz LIVE',
      `- 업체: ${business || '(이름없음)'}`,
      `- slug: ${slug}`,
      `- URL: ${url}`,
      `- checks: source(${sourceLabel}) + sitehtml(${sitehtml.code}) + marker(ok) + http(${headCode})`,
      `- ID: ${id}`,
    ].join('\n'));

    done++;
    console.log(`LIVE verified row ${i + 1}`);
  }

  console.log(`live-verify done: ${done}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

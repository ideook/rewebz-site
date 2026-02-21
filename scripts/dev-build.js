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

function extractHtml(text = '') {
  const t = String(text || '').trim();
  const fenced = t.match(/```html\s*([\s\S]*?)```/i) || t.match(/```\s*([\s\S]*?)```/i);
  const html = fenced ? fenced[1].trim() : t;
  if (!/^<!doctype html>|^<html/i.test(html)) return '';
  return html;
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
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `시트1!C${i + 1}`, values: [['DEV_DONE']] },
          { range: `시트1!L${i + 1}`, values: [[`${notes ? notes + ' | ' : ''}dev:done(gpt-5.3)`]] },
        ],
      },
    });

    processed++;
    console.log(`dev done for ${slug}`);
  }

  console.log(`dev-build done: ${processed}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

#!/usr/bin/env node
const { google } = require('googleapis');

const DISCOVERY_SHEET_ID = process.env.GOOGLE_DISCOVERY_SHEET_ID || '';
const DISCOVERY_SHEET_RANGE = process.env.GOOGLE_DISCOVERY_SHEET_RANGE || 'Discovery!A2:Q';
const MAIN_SHEET_ID = process.env.GOOGLE_SHEET_ID || '';
const MAIN_SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || '시트1!A:N';

const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

function parseArgs(argv) {
  const out = { requestId: '', rank: 1, placeId: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--request-id') { out.requestId = String(argv[++i] || '').trim(); continue; }
    if (a.startsWith('--request-id=')) { out.requestId = a.split('=')[1].trim(); continue; }
    if (a === '--rank') { out.rank = Number(argv[++i] || 1) || 1; continue; }
    if (a.startsWith('--rank=')) { out.rank = Number(a.split('=')[1]) || 1; continue; }
    if (a === '--place-id') { out.placeId = String(argv[++i] || '').trim(); continue; }
    if (a.startsWith('--place-id=')) { out.placeId = a.split('=')[1].trim(); continue; }
  }
  return out;
}

function discoverySheetName(range = '') {
  const raw = String(range || '').trim();
  if (!raw.includes('!')) return raw || 'Discovery';
  return raw.split('!')[0] || 'Discovery';
}

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    });
  } catch (_) {}
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.requestId) throw new Error('Missing --request-id');
  if (!DISCOVERY_SHEET_ID || !MAIN_SHEET_ID || !SA_EMAIL || !SA_KEY) {
    throw new Error('Missing GOOGLE sheet envs for discovery/main');
  }

  const auth = new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const dSheet = discoverySheetName(DISCOVERY_SHEET_RANGE);

  const dRes = await sheets.spreadsheets.values.get({ spreadsheetId: DISCOVERY_SHEET_ID, range: `${dSheet}!A:Q` });
  const rows = dRes.data.values || [];

  const requestRowIndex = rows.findIndex((r, i) => i > 0 && String(r?.[0] || '').trim() === args.requestId && String(r?.[2] || '').trim().startsWith('DISCOVERY_'));
  if (requestRowIndex < 0) throw new Error(`Request not found: ${args.requestId}`);

  const requestRowNum = requestRowIndex + 1;
  const requestNotes = String(rows[requestRowIndex]?.[8] || '').trim();

  const candidates = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => i > 0 && String(r?.[0] || '').trim() === args.requestId && ['FOUND', 'SHORTLISTED'].includes(String(r?.[2] || '').trim()))
    .map(({ r, i }) => ({
      rowNum: i + 1,
      title: String(r[7] || '').trim(),
      category: String(r[6] || '').trim(),
      mapLink: String(r[9] || '').trim(),
      placeId: String(r[10] || '').trim(),
      website: String(r[11] || '').trim(),
      phone: String(r[12] || '').trim(),
      rating: String(r[13] || '').trim(),
      reviews: String(r[14] || '').trim(),
      score: toNum(r[15], 0),
      source: String(r[16] || '').trim(),
    }))
    .sort((a, b) => (b.score - a.score) || (Number(b.reviews || 0) - Number(a.reviews || 0)));

  if (!candidates.length) throw new Error(`No candidates for request ${args.requestId}`);

  let selected = null;
  if (args.placeId) {
    selected = candidates.find((x) => x.placeId === args.placeId);
    if (!selected) throw new Error(`place_id not found: ${args.placeId}`);
  } else {
    const idx = Math.max(1, args.rank) - 1;
    selected = candidates[idx] || null;
    if (!selected) throw new Error(`rank out of range: ${args.rank} (candidates=${candidates.length})`);
  }

  const leadId = `rwz_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const createdAt = new Date().toISOString();

  const leadRow = [[
    leadId,
    createdAt,
    'NEW',
    selected.title || '(이름없음)',
    selected.website,
    'Discovery Engine',
    'discovery@rewebz.com',
    selected.phone,
    selected.category,
    '',
    '문의 전환율 개선',
    `discovery:${args.requestId} | place:${selected.placeId} | score:${selected.score} | rating:${selected.rating || '-'}(${selected.reviews || 0}) | map:${selected.mapLink}`,
    '',
    '',
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: MAIN_SHEET_ID,
    range: MAIN_SHEET_RANGE,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: leadRow },
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: DISCOVERY_SHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `${dSheet}!C${selected.rowNum}`, values: [['APPROVED_APPLIED']] },
        { range: `${dSheet}!C${requestRowNum}`, values: [['DISCOVERY_APPROVED']] },
        { range: `${dSheet}!I${requestRowNum}`, values: [[`${requestNotes ? requestNotes + ' | ' : ''}approved:${selected.placeId}|lead:${leadId}`]] },
      ],
    },
  });

  await sendTelegram([
    '✅ rewebz 조사 후보 승인/투입',
    `- request: ${args.requestId}`,
    `- lead: ${leadId}`,
    `- 업체: ${selected.title}`,
    `- score: ${selected.score}`,
    `- map: ${selected.mapLink}`,
  ].join('\n'));

  console.log(`approved request=${args.requestId} lead=${leadId} place=${selected.placeId}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

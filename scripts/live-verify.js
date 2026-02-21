#!/usr/bin/env node
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || '시트1!A:N';
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

async function headOk(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.status >= 200 && r.status < 400 ? r.status : 0;
  } catch {
    return 0;
  }
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
  const auth = new google.auth.JWT({ email: SA_EMAIL, key: SA_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
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
    const slug = r[12] || '';
    const url = (r[13] || '').trim();
    if (status !== 'DEV_DONE' || !url) continue;

    const code = await headOk(url);
    if (code) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: `시트1!C${i + 1}`, values: [['OPEN_DONE']] },
            { range: `시트1!L${i + 1}`, values: [[`${notes ? notes + ' | ' : ''}open:verified(${code})`]] },
          ],
        },
      });
      await sendTelegram([
        '✅ rewebz OPEN_DONE',
        `- 업체: ${business || '(이름없음)'}`,
        `- slug: ${slug || '-'}`,
        `- URL: ${url}`,
        `- HTTP: ${code}`,
        `- ID: ${id}`,
      ].join('\n'));
      done++;
      console.log(`OPEN_DONE verified row ${i + 1}`);
    }
  }

  console.log(`live-verify done: ${done}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

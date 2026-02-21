#!/usr/bin/env node
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || '시트1!A:N';
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

async function headOk(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.status >= 200 && r.status < 400 ? r.status : 0;
  } catch {
    return 0;
  }
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
    const status = (r[2] || '').trim();
    const url = (r[13] || '').trim();
    const notes = r[11] || '';
    if (status !== 'DEV_DONE' || !url) continue;

    const code = await headOk(url);
    if (code) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: `시트1!C${i + 1}`, values: [['LIVE']] },
            { range: `시트1!L${i + 1}`, values: [[`${notes ? notes + ' | ' : ''}live:verified(${code})`]] },
          ],
        },
      });
      done++;
      console.log(`LIVE verified row ${i + 1}`);
    }
  }

  console.log(`live-verify done: ${done}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

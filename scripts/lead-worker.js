#!/usr/bin/env node
/*
  Read NEW leads from Google Sheets and create Cloudflare DNS records:
  {slug}.rewebz.com -> cname.vercel-dns.com (DNS only)
*/

const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || '시트1!A:N';
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'rewebz.com';
const TARGET_CNAME = process.env.CF_TARGET_CNAME || 'cname.vercel-dns.com';

function slugify(input = '') {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/[가-힣]/g, '') || `lead-${Date.now().toString(36)}`;
}

async function cfRequest(path, options = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${CF_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const json = await res.json();
  if (!json.success) {
    const msg = JSON.stringify(json.errors || json.messages || json, null, 2);
    throw new Error(`Cloudflare API failed: ${msg}`);
  }
  return json.result;
}

async function upsertCname(subdomain) {
  const name = `${subdomain}.${ROOT_DOMAIN}`;
  const encodedName = encodeURIComponent(name);
  const list = await cfRequest(`/zones/${CF_ZONE_ID}/dns_records?type=CNAME&name=${encodedName}`);

  if (Array.isArray(list) && list.length > 0) {
    const record = list[0];
    await cfRequest(`/zones/${CF_ZONE_ID}/dns_records/${record.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        type: 'CNAME',
        name,
        content: TARGET_CNAME,
        ttl: 1,
        proxied: false,
      }),
    });
    return { name, action: 'updated' };
  }

  await cfRequest(`/zones/${CF_ZONE_ID}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'CNAME',
      name,
      content: TARGET_CNAME,
      ttl: 1,
      proxied: false,
    }),
  });
  return { name, action: 'created' };
}

async function run() {
  if (!SHEET_ID || !SA_EMAIL || !SA_KEY) {
    throw new Error('Missing Google envs: GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY');
  }
  if (!CF_TOKEN || !CF_ZONE_ID) {
    throw new Error('Missing Cloudflare envs: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID');
  }

  const auth = new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGE,
  });

  const rows = data.values || [];
  if (rows.length <= 1) {
    console.log('No data rows');
    return;
  }

  // Header is row 1, data starts row 2
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const sheetRow = i + 1;

    const id = row[0] || '';
    const status = (row[2] || '').trim();
    const businessName = row[3] || '';
    const existingSlug = (row[12] || '').trim();

    if (status !== 'NEW') continue;

    const baseSlug = existingSlug || slugify(businessName || id);
    const uniqueSlug = `${baseSlug}-${String(id).slice(-4).toLowerCase()}`;

    try {
      const result = await upsertCname(uniqueSlug);
      const mockupUrl = `https://${uniqueSlug}.${ROOT_DOMAIN}`;

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: `시트1!C${sheetRow}`, values: [['DNS_DONE']] },
            { range: `시트1!M${sheetRow}`, values: [[uniqueSlug]] },
            { range: `시트1!N${sheetRow}`, values: [[mockupUrl]] },
            { range: `시트1!L${sheetRow}`, values: [[`dns:${result.action}`]] },
          ],
        },
      });

      console.log(`Processed ${id}: ${result.action} ${result.name}`);
    } catch (err) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: `시트1!C${sheetRow}`, values: [['DNS_ERROR']] },
            { range: `시트1!L${sheetRow}`, values: [[String(err.message).slice(0, 400)]] },
          ],
        },
      });
      console.error(`Failed row ${sheetRow}:`, err.message);
    }
  }
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

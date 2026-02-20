#!/usr/bin/env node
/*
  Read leads from Google Sheets and automate:
  - slug normalization (root-cause safe)
  - Cloudflare DNS CNAME upsert
  - optional Vercel domain attach
  - sheet status updates
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

const VERCEL_TOKEN = process.env.VERCEL_TOKEN || '';
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT || '';
const VERCEL_TEAM_SLUG = process.env.VERCEL_TEAM_SLUG || '';

function baseSlug(input = '') {
  const s = (input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s;
}

function makeSafeSlug(businessName, id) {
  const suffix = String(id || '').slice(-4).toLowerCase().replace(/[^a-z0-9]/g, '') || Date.now().toString(36).slice(-4);
  const b = baseSlug(businessName);
  const prefix = b ? b.slice(0, 28).replace(/-$/g, '') : 'lead';
  const slug = `${prefix}-${suffix}`.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return slug;
}

function isMalformedSlug(slug = '') {
  return !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug);
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

async function deleteRecordByName(name) {
  const fqdn = `${name}.${ROOT_DOMAIN}`;
  const list = await cfRequest(`/zones/${CF_ZONE_ID}/dns_records?name=${encodeURIComponent(fqdn)}`);
  for (const rec of list) {
    await cfRequest(`/zones/${CF_ZONE_ID}/dns_records/${rec.id}`, { method: 'DELETE' });
  }
}

async function upsertCname(subdomain) {
  const name = `${subdomain}.${ROOT_DOMAIN}`;
  const list = await cfRequest(`/zones/${CF_ZONE_ID}/dns_records?type=CNAME&name=${encodeURIComponent(name)}`);

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

  try {
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
  } catch (e) {
    // Handle conflict like code 81053 (existing A/AAAA/CNAME on same host)
    const all = await cfRequest(`/zones/${CF_ZONE_ID}/dns_records?name=${encodeURIComponent(name)}`);
    if (all.length) {
      for (const rec of all) {
        if (['A', 'AAAA', 'CNAME'].includes(rec.type)) {
          await cfRequest(`/zones/${CF_ZONE_ID}/dns_records/${rec.id}`, { method: 'DELETE' });
        }
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
      return { name, action: 'recreated' };
    }
    throw e;
  }
}

async function ensureVercelDomain(fqdn) {
  if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) {
    return { ok: false, skipped: true, reason: 'missing_vercel_env' };
  }
  const qs = VERCEL_TEAM_SLUG ? `?teamSlug=${encodeURIComponent(VERCEL_TEAM_SLUG)}` : '';
  const url = `https://api.vercel.com/v10/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/domains${qs}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: fqdn }),
  });

  const data = await res.json();
  if (res.ok) return { ok: true, created: true };

  const msg = JSON.stringify(data);
  if (res.status === 409 || /already exists|in use|owned/i.test(msg)) {
    return { ok: true, created: false, already: true };
  }
  throw new Error(`Vercel domain add failed: ${msg}`);
}

async function updateRow(sheets, rowIndex, dataArr) {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: dataArr.map((d) => ({ range: `시트1!${d.col}${rowIndex}`, values: [[d.val]] })),
    },
  });
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

  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: SHEET_RANGE });
  const rows = data.values || [];
  if (rows.length <= 1) return console.log('No data rows');

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;

    const id = row[0] || '';
    const status = (row[2] || '').trim();
    const businessName = row[3] || '';
    const currentSlug = (row[12] || '').trim();

    const shouldProcessNew = status === 'NEW';
    const shouldRetryError = status === 'DNS_ERROR' && !!currentSlug;
    const shouldRepair = !!currentSlug && isMalformedSlug(currentSlug);
    const shouldAttachVercelOnly = status === 'DNS_DONE' && !!currentSlug && !isMalformedSlug(currentSlug);
    if (!shouldProcessNew && !shouldRetryError && !shouldRepair && !shouldAttachVercelOnly) continue;

    const nextSlug = (shouldAttachVercelOnly || shouldRetryError) ? currentSlug : makeSafeSlug(businessName, id);

    try {
      if (shouldRepair && currentSlug !== nextSlug) {
        await deleteRecordByName(currentSlug).catch(() => {});
      }

      const dns = await upsertCname(nextSlug);
      const fqdn = `${nextSlug}.${ROOT_DOMAIN}`;
      const mockupUrl = `https://${fqdn}`;

      let note = `dns:${dns.action}`;
      let nextStatus = 'DNS_DONE';
      const vercel = await ensureVercelDomain(fqdn);
      if (vercel.ok) {
        note += vercel.skipped ? ' | vercel:skipped' : vercel.already ? ' | vercel:exists' : ' | vercel:created';
        nextStatus = vercel.skipped ? 'DNS_DONE' : 'MOCKUP_LIVE';
      }

      await updateRow(sheets, rowNum, [
        { col: 'C', val: nextStatus },
        { col: 'M', val: nextSlug },
        { col: 'N', val: mockupUrl },
        { col: 'L', val: note },
      ]);

      console.log(`Processed ${id}: ${fqdn} (${nextStatus})`);
    } catch (err) {
      await updateRow(sheets, rowNum, [
        { col: 'C', val: 'DNS_ERROR' },
        { col: 'L', val: String(err.message).slice(0, 400) },
      ]);
      console.error(`Failed row ${rowNum}: ${err.message}`);
    }
  }
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

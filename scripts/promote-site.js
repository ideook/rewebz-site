#!/usr/bin/env node
const { google } = require('googleapis');

const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'rewebz.com';
const TENANT_ROOT_DOMAIN = process.env.TENANT_ROOT_DOMAIN || `preview.${ROOT_DOMAIN}`;
const CF_TARGET_CNAME = process.env.CF_TARGET_CNAME || 'cname.vercel-dns.com';

const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const CF_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || '';

const VERCEL_TOKEN = process.env.VERCEL_TOKEN || '';
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT || '';
const VERCEL_TEAM_SLUG = process.env.VERCEL_TEAM_SLUG || '';

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '';
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || '시트1!A:N';
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const BUILD_MARKER_NAME = 'rewebz-build-marker';

function parseArgs(argv) {
  const opts = {
    slug: '',
    id: '',
    url: '',
    ref: '',
    dryRun: false,
    noTelegram: false,
    timeoutSec: 600,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slug') {
      opts.slug = String(argv[++i] || '').trim();
      continue;
    }
    if (a.startsWith('--slug=')) {
      opts.slug = a.slice('--slug='.length).trim();
      continue;
    }
    if (a === '--id') {
      opts.id = String(argv[++i] || '').trim();
      continue;
    }
    if (a.startsWith('--id=')) {
      opts.id = a.slice('--id='.length).trim();
      continue;
    }
    if (a === '--url') {
      opts.url = String(argv[++i] || '').trim();
      continue;
    }
    if (a.startsWith('--url=')) {
      opts.url = a.slice('--url='.length).trim();
      continue;
    }
    if (a === '--ref') {
      opts.ref = String(argv[++i] || '').trim();
      continue;
    }
    if (a.startsWith('--ref=')) {
      opts.ref = a.slice('--ref='.length).trim();
      continue;
    }
    if (a === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (a === '--no-telegram') {
      opts.noTelegram = true;
      continue;
    }
    if (a === '--timeoutSec') {
      opts.timeoutSec = Number(argv[++i] || 600) || 600;
      continue;
    }
    if (a.startsWith('--timeoutSec=')) {
      opts.timeoutSec = Number(a.slice('--timeoutSec='.length)) || 600;
      continue;
    }

    // positional convenience: accept slug / id / url without flags
    if (!a.startsWith('-') && !opts.ref) {
      opts.ref = String(a || '').trim();
      continue;
    }

    throw new Error(`Unknown argument: ${a}`);
  }

  return opts;
}

function isValidSlug(slug = '') {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(String(slug || '').trim());
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function escRe(s = '') {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function markerContent(slug = '') {
  return `rwz-live-v2:${slug}`;
}

function hasBuildMarker(html = '', slug = '') {
  const marker = markerContent(slug);
  const rx = new RegExp(
    `<meta[^>]*name=["']${escRe(BUILD_MARKER_NAME)}["'][^>]*content=["'][^"']*${escRe(marker)}[^"']*["'][^>]*>`,
    'i',
  );
  return rx.test(String(html || ''));
}

function joinText(parts) {
  return parts.filter(Boolean).join(' | ');
}

function parseHostFromUrl(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`https://${raw}`).hostname.toLowerCase();
    } catch {
      return '';
    }
  }
}

function normalizeRef(ref = '') {
  return String(ref || '').trim();
}

function extractSlugFromHost(host = '') {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return '';

  const suffixes = [...new Set([TENANT_ROOT_DOMAIN, ROOT_DOMAIN, `preview.${ROOT_DOMAIN}`])]
    .filter(Boolean)
    .map((x) => String(x).toLowerCase().replace(/\.$/, ''))
    .sort((a, b) => b.length - a.length);

  for (const s of suffixes) {
    if (h === s || h === `www.${s}`) return '';
    if (h.endsWith(`.${s}`)) {
      const candidate = h.slice(0, -1 * (`.${s}`.length));
      if (isValidSlug(candidate)) return candidate;
    }
  }
  return '';
}

function extractSlugFromUrl(url = '') {
  return extractSlugFromHost(parseHostFromUrl(url));
}

function withTeamSlug(url) {
  if (!VERCEL_TEAM_SLUG) return url;
  return `${url}${url.includes('?') ? '&' : '?'}teamSlug=${encodeURIComponent(VERCEL_TEAM_SLUG)}`;
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
  const json = await res.json().catch(() => ({}));
  if (!json.success) {
    throw new Error(`Cloudflare API failed (${path}): ${JSON.stringify(json.errors || json.messages || json)}`);
  }
  return json.result;
}

async function listDnsByName(fqdn) {
  return cfRequest(`/zones/${CF_ZONE_ID}/dns_records?name=${encodeURIComponent(fqdn)}&per_page=100`);
}

async function ensureProdDnsCname(fqdn, dryRun = false) {
  const records = await listDnsByName(fqdn);
  const cname = records.find((r) => r.type === 'CNAME');

  if (dryRun) {
    if (!cname) {
      return { action: 'create', created: false, recordId: '', dryRun: true };
    }
    if (String(cname.content || '').replace(/\.$/, '') !== CF_TARGET_CNAME.replace(/\.$/, '') || cname.proxied !== false) {
      return { action: 'update', created: false, recordId: cname.id, dryRun: true };
    }
    return { action: 'noop', created: false, recordId: cname.id, dryRun: true };
  }

  // Remove conflicting A/AAAA/CNAME records at same name before creating CNAME.
  for (const rec of records) {
    if (rec.type !== 'CNAME' && ['A', 'AAAA'].includes(rec.type)) {
      await cfRequest(`/zones/${CF_ZONE_ID}/dns_records/${rec.id}`, { method: 'DELETE' });
    }
  }

  if (cname) {
    const desired = CF_TARGET_CNAME.replace(/\.$/, '');
    const current = String(cname.content || '').replace(/\.$/, '');
    if (current === desired && cname.proxied === false) {
      return { action: 'noop', created: false, recordId: cname.id };
    }
    const out = await cfRequest(`/zones/${CF_ZONE_ID}/dns_records/${cname.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        type: 'CNAME',
        name: fqdn,
        content: CF_TARGET_CNAME,
        ttl: 1,
        proxied: false,
      }),
    });
    return { action: 'update', created: false, recordId: out.id || cname.id };
  }

  const out = await cfRequest(`/zones/${CF_ZONE_ID}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'CNAME',
      name: fqdn,
      content: CF_TARGET_CNAME,
      ttl: 1,
      proxied: false,
    }),
  });
  return { action: 'create', created: true, recordId: out.id || '' };
}

async function deleteDnsRecord(recordId) {
  if (!recordId) return;
  await cfRequest(`/zones/${CF_ZONE_ID}/dns_records/${recordId}`, { method: 'DELETE' });
}

async function vercelRequest(path, options = {}) {
  const res = await fetch(withTeamSlug(`https://api.vercel.com${path}`), {
    ...options,
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: json };
}

async function ensureVercelDomain(fqdn, dryRun = false) {
  if (dryRun) return { action: 'create', created: false, dryRun: true };

  const add = await vercelRequest(`/v10/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/domains`, {
    method: 'POST',
    body: JSON.stringify({ name: fqdn }),
  });

  if (add.ok) return { action: 'create', created: true };

  const msg = JSON.stringify(add.data || {});
  if (add.status === 409 || /already exists|already in use|owned|exists/i.test(msg)) {
    return { action: 'noop', created: false };
  }

  throw new Error(`Vercel domain add failed: status=${add.status} body=${msg}`);
}

async function deleteVercelDomain(fqdn) {
  await vercelRequest(`/v10/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/domains/${encodeURIComponent(fqdn)}`, {
    method: 'DELETE',
  });
}

async function getVercelDomainConfig(fqdn) {
  const cfg = await vercelRequest(`/v6/domains/${encodeURIComponent(fqdn)}/config`);
  if (!cfg.ok) {
    throw new Error(`Vercel domain config failed: status=${cfg.status} body=${JSON.stringify(cfg.data)}`);
  }
  return cfg.data || {};
}

async function waitUntilVercelDomainReady(fqdn, timeoutSec) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutSec * 1000) {
    const cfg = await getVercelDomainConfig(fqdn);
    last = cfg;
    if (cfg.misconfigured === false) {
      return cfg;
    }
    await sleep(5000);
  }
  throw new Error(`Timed out waiting Vercel domain ready: ${fqdn} last=${JSON.stringify(last || {})}`);
}

async function headOk(url, tries = 3) {
  let lastCode = 0;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      lastCode = r.status;
      if (r.status >= 200 && r.status < 400) return r.status;
    } catch (_) {}
    await sleep(2500);
  }
  return lastCode;
}

async function tenantApiCheck(hostname, slug, tries = 3) {
  const api = `https://${hostname}/api/sitehtml`;
  let lastCode = 0;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(api, { method: 'GET', headers: { 'Cache-Control': 'no-cache' } });
      lastCode = r.status;
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && j?.kind === 'tenant' && (j?.slug || '').trim() === slug && /<html/i.test(j?.html || '')) {
        return {
          code: r.status,
          markerOk: hasBuildMarker(j?.html || '', slug),
        };
      }
    } catch (_) {}
    await sleep(2500);
  }
  return { code: lastCode, markerOk: false };
}

async function loadSheets() {
  if (!SHEET_ID || !SA_EMAIL || !SA_KEY) return null;
  const auth = new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function readSheetRows(sheets) {
  if (!sheets) return [];
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: SHEET_RANGE });
  return data.values || [];
}

async function findSheetRowBySlug(sheets, slug) {
  if (!sheets) return null;
  const rows = await readSheetRows(sheets);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if ((r[12] || '').trim().toLowerCase() === slug.toLowerCase()) {
      return {
        rowNum: i + 1,
        row: r,
      };
    }
  }
  return null;
}

async function findSheetRowById(sheets, id) {
  if (!sheets) return null;
  const rows = await readSheetRows(sheets);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if ((r[0] || '').trim() === id) {
      return {
        rowNum: i + 1,
        row: r,
      };
    }
  }
  return null;
}

async function resolvePromotionTarget(sheets, opts) {
  const explicitSlug = normalizeRef(opts.slug);
  if (explicitSlug) {
    if (!isValidSlug(explicitSlug)) throw new Error(`Invalid slug: ${explicitSlug}`);
    const rowHit = await findSheetRowBySlug(sheets, explicitSlug).catch(() => null);
    return { slug: explicitSlug.toLowerCase(), rowHit, sourceHintHost: '' };
  }

  const explicitUrl = normalizeRef(opts.url);
  if (explicitUrl) {
    const slug = extractSlugFromUrl(explicitUrl);
    if (!slug) throw new Error(`Could not extract slug from URL: ${explicitUrl}`);
    const rowHit = await findSheetRowBySlug(sheets, slug).catch(() => null);
    return { slug, rowHit, sourceHintHost: parseHostFromUrl(explicitUrl) };
  }

  const explicitId = normalizeRef(opts.id);
  if (explicitId) {
    const rowHit = await findSheetRowById(sheets, explicitId).catch(() => null);
    if (!rowHit) throw new Error(`Could not find sheet row by id: ${explicitId}`);
    const slug = String(rowHit.row?.[12] || '').trim().toLowerCase();
    if (!isValidSlug(slug)) throw new Error(`Row found but slug is invalid/missing for id=${explicitId}`);
    return { slug, rowHit, sourceHintHost: '' };
  }

  const ref = normalizeRef(opts.ref);
  if (ref) {
    if (ref.startsWith('http://') || ref.startsWith('https://') || ref.includes('.')) {
      const slug = extractSlugFromUrl(ref);
      if (slug) {
        const rowHit = await findSheetRowBySlug(sheets, slug).catch(() => null);
        return { slug, rowHit, sourceHintHost: parseHostFromUrl(ref) };
      }
    }

    if (/^rwz_/i.test(ref)) {
      const rowHit = await findSheetRowById(sheets, ref).catch(() => null);
      if (!rowHit) throw new Error(`Could not find sheet row by id: ${ref}`);
      const slug = String(rowHit.row?.[12] || '').trim().toLowerCase();
      if (!isValidSlug(slug)) throw new Error(`Row found but slug is invalid/missing for id=${ref}`);
      return { slug, rowHit, sourceHintHost: '' };
    }

    if (isValidSlug(ref)) {
      const rowHit = await findSheetRowBySlug(sheets, ref).catch(() => null);
      return { slug: ref.toLowerCase(), rowHit, sourceHintHost: '' };
    }

    throw new Error(`Could not parse reference: ${ref}`);
  }

  throw new Error('Missing target. Use one of: --slug <slug> | --id <requestId> | --url <previewUrl> | --ref <value>');
}

async function updateSheetRowPromotion(sheets, rowNum, currentNotes, prodUrl, checksNote, dryRun = false) {
  if (!sheets || !rowNum) return;
  const mergedNote = joinText([currentNotes || '', checksNote]);
  if (dryRun) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `시트1!C${rowNum}`, values: [['LIVE']] },
        { range: `시트1!N${rowNum}`, values: [[prodUrl]] },
        { range: `시트1!L${rowNum}`, values: [[mergedNote]] },
      ],
    },
  });
}

function resolveSourceHost(slug, rowUrl = '', sourceHintHost = '') {
  const byHint = parseHostFromUrl(sourceHintHost);
  if (byHint) return byHint;

  const t = String(TENANT_ROOT_DOMAIN || '').toLowerCase();
  if (t.startsWith('preview.') || t.includes('.preview.')) {
    return `${slug}.${t}`;
  }

  const byUrl = parseHostFromUrl(rowUrl);
  if (byUrl) return byUrl;

  return `${slug}.preview.${ROOT_DOMAIN}`;
}

async function sendTelegram(text, noTelegram) {
  if (noTelegram) return;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: true,
    }),
  }).catch(() => {});
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!CF_TOKEN || !CF_ZONE_ID) throw new Error('Missing Cloudflare envs: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID');
  if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) throw new Error('Missing Vercel envs: VERCEL_TOKEN / VERCEL_PROJECT_ID');

  const sheets = await loadSheets();
  const resolved = await resolvePromotionTarget(sheets, opts);

  const slug = resolved.slug.toLowerCase();
  if (!isValidSlug(slug)) throw new Error(`Invalid slug: ${slug}`);

  const prodFqdn = `${slug}.${ROOT_DOMAIN}`;
  const prodUrl = `https://${prodFqdn}`;

  const rowHit = resolved.rowHit || await findSheetRowBySlug(sheets, slug).catch(() => null);
  const row = rowHit?.row || [];
  const rowNum = rowHit?.rowNum || 0;
  const rowId = (row[0] || '').trim();
  const rowStatus = (row[2] || '').trim();
  const rowNotes = row[11] || '';
  const rowUrl = row[13] || '';

  if (rowNum && rowStatus && rowStatus !== 'LIVE') {
    throw new Error(`Row found but status is not LIVE (row ${rowNum}, status=${rowStatus})`);
  }

  const sourceHost = resolveSourceHost(slug, rowUrl, resolved.sourceHintHost || '');
  const sourceCheck = await tenantApiCheck(sourceHost, slug, 3);
  if (!sourceCheck.code || !sourceCheck.markerOk) {
    throw new Error(`Source check failed on ${sourceHost}: sitehtml=${sourceCheck.code}, marker=${sourceCheck.markerOk}`);
  }

  const created = { dnsRecordId: '', vercelDomain: false };

  try {
    console.log(`[promote] slug=${slug}`);
    console.log(`[promote] source_host=${sourceHost} source_check=sitehtml:${sourceCheck.code},marker:ok`);

    const dns = await ensureProdDnsCname(prodFqdn, opts.dryRun);
    if (dns.created) created.dnsRecordId = dns.recordId;
    console.log(`[promote] dns=${dns.action} target=${CF_TARGET_CNAME}${opts.dryRun ? ' (dry-run)' : ''}`);

    const vd = await ensureVercelDomain(prodFqdn, opts.dryRun);
    if (vd.created) created.vercelDomain = true;
    console.log(`[promote] vercel_domain=${vd.action}${opts.dryRun ? ' (dry-run)' : ''}`);

    if (opts.dryRun) {
      console.log('[promote] dry-run complete');
      return;
    }

    await waitUntilVercelDomainReady(prodFqdn, opts.timeoutSec);
    console.log('[promote] vercel_domain=ready');

    const headCode = await headOk(prodUrl, 4);
    if (!headCode || headCode >= 400) {
      throw new Error(`Prod HEAD check failed: ${prodUrl} status=${headCode}`);
    }

    const prodSite = await tenantApiCheck(prodFqdn, slug, 4);
    if (!prodSite.code || !prodSite.markerOk) {
      throw new Error(`Prod sitehtml check failed: host=${prodFqdn} sitehtml=${prodSite.code} marker=${prodSite.markerOk}`);
    }

    const checks = `promote:done(prod:${prodUrl}, checks:dns:${dns.action},vercel:${vd.action},head:${headCode},sitehtml:${prodSite.code},marker:ok)`;

    if (!rowNum) {
      console.warn(`[promote] warning: sheet row not found for slug=${slug}`);
    } else {
      await updateSheetRowPromotion(sheets, rowNum, rowNotes, prodUrl, checks, false);
      console.log(`[promote] sheet updated row=${rowNum}`);
    }

    await sendTelegram([
      '✅ rewebz PROMOTED',
      `- slug: ${slug}`,
      rowId ? `- ID: ${rowId}` : '',
      `- prod: ${prodUrl}`,
      `- checks: dns(${dns.action}) + vercel(${vd.action}) + head(${headCode}) + sitehtml(${prodSite.code}) + marker(ok)`,
    ].filter(Boolean).join('\n'), opts.noTelegram);

    console.log(`[promote] success ${slug} -> ${prodUrl}`);
  } catch (err) {
    console.error(`[promote] failed: ${err.message}`);

    // Best-effort rollback only for resources created in this run.
    if (!opts.dryRun) {
      if (created.vercelDomain) {
        try {
          await deleteVercelDomain(prodFqdn);
          console.error('[promote] rollback: removed vercel domain attach');
        } catch (e) {
          console.error(`[promote] rollback warn (vercel): ${e.message}`);
        }
      }
      if (created.dnsRecordId) {
        try {
          await deleteDnsRecord(created.dnsRecordId);
          console.error('[promote] rollback: removed dns record');
        } catch (e) {
          console.error(`[promote] rollback warn (dns): ${e.message}`);
        }
      }
    }

    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

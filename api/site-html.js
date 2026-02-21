const fs = require('fs');
const path = require('path');

const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'rewebz.com';
const TENANT_ROOT_DOMAIN = process.env.TENANT_ROOT_DOMAIN || `preview.${ROOT_DOMAIN}`;
const LEGACY_TENANT_ROOT_DOMAIN = process.env.LEGACY_TENANT_ROOT_DOMAIN || ROOT_DOMAIN;
const { getLiveHtmlForSlug } = require('../lib/r2');

function hostFromReq(req) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase().split(':')[0];
}

function candidateSuffixes() {
  return [...new Set([TENANT_ROOT_DOMAIN, LEGACY_TENANT_ROOT_DOMAIN, ROOT_DOMAIN])]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function sanitizeSlug(slug = '') {
  const s = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s)) return '';
  return s;
}

function slugFromHost(host) {
  if (!host) return '';
  for (const suffix of candidateSuffixes()) {
    if (host === suffix || host === `www.${suffix}`) return '';
    if (host.endsWith(`.${suffix}`)) {
      const slug = host.slice(0, -1 * (`.${suffix}`.length));
      return sanitizeSlug(slug);
    }
  }
  return '';
}

module.exports = async (req, res) => {
  try {
    const slug = slugFromHost(hostFromReq(req));
    if (!slug) return res.status(200).json({ ok: true, kind: 'root' });

    const r2 = await getLiveHtmlForSlug(slug).catch(() => null);
    if (r2?.html) {
      return res.status(200).json({ ok: true, kind: 'tenant', slug, html: r2.html, source: 'r2', version: r2.version || '' });
    }

    const filePath = path.join(process.cwd(), 'sites', slug, 'index.html');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, kind: 'tenant', error: 'site_source_not_found', slug });
    }

    const html = fs.readFileSync(filePath, 'utf8');
    return res.status(200).json({ ok: true, kind: 'tenant', slug, html, source: 'local' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'site_html_api_error', detail: e.message });
  }
};

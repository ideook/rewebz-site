const fs = require('fs');
const path = require('path');

const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'rewebz.com';

function hostFromReq(req) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase().split(':')[0];
}

function slugFromHost(host) {
  if (!host) return '';
  if (host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}`) return '';
  if (!host.endsWith(`.${ROOT_DOMAIN}`)) return '';
  return host.slice(0, -1 * (`.${ROOT_DOMAIN}`.length));
}

module.exports = async (req, res) => {
  try {
    const slug = slugFromHost(hostFromReq(req));
    if (!slug) return res.status(200).json({ ok: true, kind: 'root' });

    const filePath = path.join(process.cwd(), 'sites', slug, 'index.html');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, kind: 'tenant', error: 'site_source_not_found', slug });
    }

    const html = fs.readFileSync(filePath, 'utf8');
    return res.status(200).json({ ok: true, kind: 'tenant', slug, html });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'site_html_api_error', detail: e.message });
  }
};

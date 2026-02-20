const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || '시트1!A:N';
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'rewebz.com';

function cleanHost(req) {
  const h = (req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  return h.split(':')[0];
}

function getSlugFromHost(host) {
  if (!host) return '';
  if (host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}`) return '';
  if (host.endsWith(`.${ROOT_DOMAIN}`)) {
    return host.slice(0, -1 * (`.${ROOT_DOMAIN}`.length));
  }
  return '';
}

module.exports = async (req, res) => {
  try {
    const host = cleanHost(req);
    const slug = getSlugFromHost(host);

    if (!slug) {
      return res.status(200).json({ ok: true, kind: 'root' });
    }

    const auth = new google.auth.JWT({
      email: SA_EMAIL,
      key: SA_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: SHEET_RANGE,
    });

    const rows = data.values || [];
    const match = rows.slice(1).find((r) => (r[12] || '').trim().toLowerCase() === slug);

    if (!match) {
      return res.status(404).json({ ok: false, error: 'mockup_not_found', slug });
    }

    const businessName = match[3] || '업체명 미정';
    const websiteUrl = match[4] || '';
    const category = match[8] || '서비스업';
    const region = match[9] || '지역 미정';
    const goal = match[10] || '문의 전환율 개선';

    return res.status(200).json({
      ok: true,
      kind: 'tenant',
      slug,
      businessName,
      websiteUrl,
      category,
      region,
      goal,
      ctaLabel: '무료 개선안 받기',
      ctaLink: `mailto:hello@${ROOT_DOMAIN}?subject=${encodeURIComponent(`[${businessName}] 개선안 문의`)}`,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'mockup_api_error', detail: error.message });
  }
};

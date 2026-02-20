const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || '시트1!A:N';

const MANIFEST_PATH = path.join(process.cwd(), 'sites', '_manifest.json');

module.exports = async (_req, res) => {
  try {
    if (fs.existsSync(MANIFEST_PATH)) {
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      const items = (manifest.items || []).slice(0, 24);
      return res.status(200).json({ ok: true, source: 'manifest', items });
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
    const items = rows
      .slice(1)
      .map((r) => ({
        id: r[0] || '',
        created_at: r[1] || '',
        status: r[2] || '',
        business_name: r[3] || '',
        category: r[8] || '',
        region: r[9] || '',
        goal: r[10] || '',
        notes: r[11] || '',
        slug: r[12] || '',
        mockup_url: r[13] || '',
      }))
      .filter((x) => x.slug && x.mockup_url && ['MOCKUP_LIVE', 'READY'].includes((x.status || '').trim()))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 24);

    return res.status(200).json({ ok: true, source: 'sheet', items });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'gallery_api_error', detail: error.message });
  }
};

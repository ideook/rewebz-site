const { google } = require('googleapis');

function pick(obj, key) {
  return (obj?.[key] || '').toString().trim();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const business_name = pick(body, 'business_name');
    const contact_name = pick(body, 'contact_name');
    const contact_email = pick(body, 'contact_email');

    if (!business_name || !contact_name || !contact_email) {
      return res.status(400).json({ error: 'business_name, contact_name, contact_email are required' });
    }

    const requestId = `rwz_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const createdAt = new Date().toISOString();

    const payload = {
      id: requestId,
      created_at: createdAt,
      status: 'NEW',
      business_name,
      website_url: pick(body, 'website_url'),
      contact_name,
      contact_email,
      contact_phone: pick(body, 'contact_phone'),
      category: pick(body, 'category'),
      region: pick(body, 'region'),
      goal: pick(body, 'goal'),
      notes: pick(body, 'notes'),
      slug: '',
      mockup_url: '',
    };

    const client = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth: client });

    const values = [[
      payload.id,
      payload.created_at,
      payload.status,
      payload.business_name,
      payload.website_url,
      payload.contact_name,
      payload.contact_email,
      payload.contact_phone,
      payload.category,
      payload.region,
      payload.goal,
      payload.notes,
      payload.slug,
      payload.mockup_url,
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: process.env.GOOGLE_SHEET_RANGE || '시트1!A:N',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });

    return res.status(200).json({ ok: true, requestId });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to save request',
      detail: error.message,
    });
  }
};

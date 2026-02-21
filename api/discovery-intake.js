const { google } = require('googleapis');

const DISCOVERY_HEADERS = [
  'request_id',      // A
  'created_at',      // B
  'stage',           // C
  'lat',             // D
  'lng',             // E
  'metric_m',        // F (radius for request, distance for candidate)
  'category',        // G
  'title',           // H
  'notes',           // I
  'map_link',        // J
  'ref_id',          // K (place id or internal ref)
  'website_url',     // L
  'phone',           // M
  'rating',          // N
  'reviews',         // O
  'score',           // P
  'source',          // Q
];

function pick(obj, key) {
  return (obj?.[key] || '').toString().trim();
}

function asNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseCategories(body) {
  if (Array.isArray(body?.categories)) {
    return body.categories.map((x) => String(x || '').trim()).filter(Boolean);
  }
  const raw = pick(body, 'categories');
  if (!raw) return [];
  return raw.split(',').map((x) => x.trim()).filter(Boolean);
}

function discoverySheetNameFromRange(range = '') {
  const raw = String(range || '').trim();
  if (!raw.includes('!')) return raw || 'Discovery';
  return raw.split('!')[0] || 'Discovery';
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_CHAT_ID || '';
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
  } catch (_) {}
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const center_lat = asNum(body?.center_lat, NaN);
    const center_lng = asNum(body?.center_lng, NaN);
    const radius_m = Math.max(300, Math.min(10000, asNum(body?.radius_m, 2000)));
    const categories = parseCategories(body);

    if (!Number.isFinite(center_lat) || !Number.isFinite(center_lng)) {
      return res.status(400).json({ error: 'center_lat, center_lng are required' });
    }
    if (!categories.length) {
      return res.status(400).json({ error: 'categories is required' });
    }

    const requestId = `rwzd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const createdAt = new Date().toISOString();

    const payload = {
      id: requestId,
      created_at: createdAt,
      stage: 'DISCOVERY_NEW',
      center_lat,
      center_lng,
      radius_m,
      categories,
      keyword: pick(body, 'keyword'),
      notes: pick(body, 'notes'),
      map_link: pick(body, 'map_link') || `https://maps.google.com/?q=${center_lat},${center_lng}`,
    };

    const discoverySheetId = process.env.GOOGLE_DISCOVERY_SHEET_ID || '';
    const discoveryRange = process.env.GOOGLE_DISCOVERY_SHEET_RANGE || 'Discovery!A2:Q';

    let saved = false;
    if (discoverySheetId && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      const client = new google.auth.JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const sheets = google.sheets({ version: 'v4', auth: client });
      const sheetName = discoverySheetNameFromRange(discoveryRange);
      const headerRange = `${sheetName}!A1:Q1`;
      const appendRange = `${sheetName}!A2:Q`;

      const head = await sheets.spreadsheets.values.get({
        spreadsheetId: discoverySheetId,
        range: headerRange,
      }).catch(() => ({ data: { values: [] } }));

      const firstCell = String(head?.data?.values?.[0]?.[0] || '').trim().toLowerCase();
      const headerSize = head?.data?.values?.[0]?.length || 0;
      if (firstCell !== 'request_id' || headerSize < DISCOVERY_HEADERS.length) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: discoverySheetId,
          range: headerRange,
          valueInputOption: 'RAW',
          requestBody: { values: [DISCOVERY_HEADERS] },
        });
      }

      await sheets.spreadsheets.values.append({
        spreadsheetId: discoverySheetId,
        range: appendRange,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [[
            payload.id,
            payload.created_at,
            payload.stage,
            payload.center_lat,
            payload.center_lng,
            payload.radius_m,
            payload.categories.join(', '),
            payload.keyword || '(request)',
            payload.notes,
            payload.map_link,
            '', // ref_id
            '', // website_url
            '', // phone
            '', // rating
            '', // reviews
            '', // score
            'intake',
          ]],
        },
      });
      saved = true;
    }

    await sendTelegram([
      '🧭 rewebz 조사 요청 접수',
      `- ID: ${requestId}`,
      `- 위치: ${center_lat.toFixed(6)}, ${center_lng.toFixed(6)} (r=${radius_m}m)`,
      `- 업종: ${categories.join(', ')}`,
      `- 키워드: ${payload.keyword || '-'}`,
      `- 시트저장: ${saved ? 'YES' : 'NO (GOOGLE_DISCOVERY_SHEET_ID 미설정)'}`,
      `- 지도: ${payload.map_link}`,
    ].join('\n'));

    return res.status(200).json({ ok: true, requestId, saved });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to save discovery request',
      detail: error.message,
    });
  }
};

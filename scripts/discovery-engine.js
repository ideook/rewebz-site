#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const REQUEST_SHEET_ID = process.env.GOOGLE_DISCOVERY_SHEET_ID || '';
const REQUEST_SHEET_RANGE = process.env.GOOGLE_DISCOVERY_SHEET_RANGE || 'Discovery!A2:L';

const CANDIDATE_SHEET_ID = process.env.GOOGLE_DISCOVERY_CANDIDATE_SHEET_ID || REQUEST_SHEET_ID;
const CANDIDATE_SHEET_RANGE = process.env.GOOGLE_DISCOVERY_CANDIDATE_SHEET_RANGE || 'DiscoveryCandidates!A2:O';

const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

const MAX_REQUESTS = Number(process.env.DISCOVERY_ENGINE_MAX_PER_RUN || 1) || 1;
const MAX_CANDIDATES_PER_REQUEST = Number(process.env.DISCOVERY_MAX_CANDIDATES_PER_REQUEST || 12) || 12;
const MIN_SCORE = Number(process.env.DISCOVERY_MIN_SCORE || 0) || 0;

const REQUEST_HEADERS = [
  'request_id',
  'created_at',
  'stage',
  'center_lat',
  'center_lng',
  'radius_m',
  'categories',
  'keyword',
  'notes',
  'map_link',
  'collector',
  'engine_summary',
];

const CANDIDATE_HEADERS = [
  'request_id',
  'collected_at',
  'stage',
  'place_id',
  'title',
  'category',
  'distance_m',
  'rating',
  'reviews',
  'website_url',
  'phone',
  'map_link',
  'score',
  'reason',
  'source',
];

const CATEGORY_TYPE_MAP = {
  '식음료/카페': ['restaurant', 'cafe', 'bakery'],
  '마트/편의/생활': ['supermarket', 'grocery_store', 'convenience_store'],
  '병원/약국/건강': ['hospital', 'pharmacy', 'doctor'],
  '뷰티/헤어/네일': ['beauty_salon', 'hair_care', 'spa'],
  '교육/학원': ['school'],
  '반려동물': ['pet_store', 'veterinary_care'],
  '자동차/정비': ['car_repair', 'car_dealer'],
  '숙박/여행': ['lodging', 'travel_agency'],
  '부동산/인테리어': ['real_estate_agency', 'home_goods_store'],
  '전문서비스': ['accounting', 'lawyer'],
  '운동/레저': ['gym'],
  '기타 로컬 비즈니스': ['store'],
};

function parseArgs(argv) {
  return {
    requestId: (() => {
      const idx = argv.indexOf('--request-id');
      if (idx >= 0) return String(argv[idx + 1] || '').trim();
      const eq = argv.find((x) => x.startsWith('--request-id='));
      return eq ? eq.split('=')[1].trim() : '';
    })(),
  };
}

function sheetName(range = '', fallback = 'Sheet1') {
  const raw = String(range || '').trim();
  if (!raw.includes('!')) return raw || fallback;
  return raw.split('!')[0] || fallback;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseCategories(v = '') {
  return String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

function getPlacesApiKey() {
  if (process.env.GOOGLE_PLACES_API_KEY) return process.env.GOOGLE_PLACES_API_KEY;
  try {
    const cfgPath = path.resolve(process.env.HOME || '~', '.openclaw', 'openclaw.json');
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const cfg = JSON.parse(raw);
    return cfg?.skills?.entries?.goplaces?.apiKey || '';
  } catch {
    return '';
  }
}

function unique(arr) {
  return [...new Set(arr)];
}

function mapTypesFromCategories(categories) {
  const types = [];
  for (const c of categories) types.push(...(CATEGORY_TYPE_MAP[c] || []));
  return unique(types);
}

function calcScore(place) {
  const rating = Number(place.rating || 0);
  const reviews = Number(place.userRatingCount || 0);
  const website = String(place.websiteUri || '').trim();
  const phone = String(place.nationalPhoneNumber || '').trim();

  let score = 0;
  const reasons = [];

  if (!website) {
    score += 40;
    reasons.push('웹사이트 없음');
  } else if (/blog\.naver|smartstore|instagram|facebook/i.test(website)) {
    score += 12;
    reasons.push('플랫폼/임시형 웹 중심');
  }

  if (reviews < 30) {
    score += 18;
    reasons.push('리뷰 적음');
  } else if (reviews < 80) {
    score += 8;
  }

  if (!phone) {
    score += 6;
    reasons.push('전화정보 부족');
  }

  if (rating > 0 && rating < 4.0) score += 8;
  if (rating >= 4.4 && reviews >= 200 && website) score -= 12;

  return { score, reason: reasons.join(', ') };
}

async function placesSearchNearby(apiKey, type, center, radius) {
  const body = {
    includedTypes: [type],
    maxResultCount: 20,
    locationRestriction: {
      circle: {
        center: { latitude: center.lat, longitude: center.lng },
        radius,
      },
    },
    languageCode: 'ko',
    regionCode: 'KR',
  };

  const r = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.rating',
        'places.userRatingCount',
        'places.googleMapsUri',
        'places.websiteUri',
        'places.nationalPhoneNumber',
        'places.businessStatus',
        'places.primaryType',
      ].join(','),
    },
    body: JSON.stringify(body),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message || JSON.stringify(j).slice(0, 200);
    throw new Error(`places:${type} http=${r.status} ${msg}`);
  }
  return j?.places || [];
}

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    });
  } catch (_) {}
}

async function ensureSheetAndHeader(sheets, spreadsheetId, name, headerRange, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  const hasSheet = (meta.data.sheets || []).some((s) => s.properties?.title === name);
  if (!hasSheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: name } } }] },
    });
  }

  const head = await sheets.spreadsheets.values.get({ spreadsheetId, range: headerRange }).catch(() => ({ data: { values: [] } }));
  const first = String(head?.data?.values?.[0]?.[0] || '').trim().toLowerCase();
  const size = head?.data?.values?.[0]?.length || 0;
  if (first !== String(headers[0]).toLowerCase() || size < headers.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: headerRange,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!REQUEST_SHEET_ID || !SA_EMAIL || !SA_KEY) {
    throw new Error('Missing discovery request sheet envs');
  }

  const placesApiKey = getPlacesApiKey();
  if (!placesApiKey) throw new Error('Missing GOOGLE_PLACES_API_KEY');

  const auth = new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const reqSheet = sheetName(REQUEST_SHEET_RANGE, 'Discovery');
  const candSheet = sheetName(CANDIDATE_SHEET_RANGE, 'DiscoveryCandidates');

  await ensureSheetAndHeader(sheets, REQUEST_SHEET_ID, reqSheet, `${reqSheet}!A1:L1`, REQUEST_HEADERS);
  await ensureSheetAndHeader(sheets, CANDIDATE_SHEET_ID, candSheet, `${candSheet}!A1:O1`, CANDIDATE_HEADERS);

  const reqRes = await sheets.spreadsheets.values.get({ spreadsheetId: REQUEST_SHEET_ID, range: `${reqSheet}!A:L` });
  const reqRows = reqRes.data.values || [];

  const targets = [];
  for (let i = 1; i < reqRows.length; i++) {
    const r = reqRows[i] || [];
    const requestId = String(r[0] || '').trim();
    const stage = String(r[2] || '').trim();
    if (!requestId.startsWith('rwzd_')) continue;
    if (args.requestId && requestId !== args.requestId) continue;
    if (!['DISCOVERY_NEW', 'DISCOVERY_RETRY'].includes(stage)) continue;
    targets.push({ rowNum: i + 1, row: r });
  }

  let processed = 0;

  for (const t of targets.slice(0, Math.max(1, MAX_REQUESTS))) {
    const r = t.row;
    const rowNum = t.rowNum;

    const requestId = String(r[0] || '').trim();
    const center = { lat: toNum(r[3], NaN), lng: toNum(r[4], NaN) };
    const radius = Math.max(300, Math.min(10000, toNum(r[5], 2000)));
    const categories = parseCategories(r[6]);
    const reqNotes = String(r[8] || '').trim();

    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: REQUEST_SHEET_ID,
        range: `${reqSheet}!C${rowNum}`,
        valueInputOption: 'RAW',
        requestBody: { values: [['DISCOVERY_ERROR']] },
      });
      continue;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: REQUEST_SHEET_ID,
      range: `${reqSheet}!C${rowNum}`,
      valueInputOption: 'RAW',
      requestBody: { values: [['DISCOVERY_COLLECTING']] },
    });

    const candRes = await sheets.spreadsheets.values.get({ spreadsheetId: CANDIDATE_SHEET_ID, range: `${candSheet}!A:O` });
    const candRows = candRes.data.values || [];
    const existingIds = new Set(
      candRows
        .filter((x, i) => i > 0 && String(x?.[0] || '').trim() === requestId)
        .map((x) => String(x?.[3] || '').trim())
        .filter(Boolean),
    );

    const all = [];
    const types = mapTypesFromCategories(categories);

    for (const type of types) {
      try {
        const found = await placesSearchNearby(placesApiKey, type, center, radius);
        for (const p of found) {
          if (!p?.id || existingIds.has(p.id)) continue;

          const distance = haversineM(
            center.lat,
            center.lng,
            Number(p.location?.latitude || center.lat),
            Number(p.location?.longitude || center.lng),
          );
          const scored = calcScore(p);

          const plat = Number(p.location?.latitude || center.lat);
          const plng = Number(p.location?.longitude || center.lng);
          all.push({
            request_id: requestId,
            collected_at: new Date().toISOString(),
            stage: 'FOUND',
            place_id: p.id,
            title: p.displayName?.text || '(이름없음)',
            category: p.primaryType || type,
            distance_m: distance,
            rating: p.rating ?? '',
            reviews: p.userRatingCount ?? '',
            website_url: p.websiteUri || '',
            phone: p.nationalPhoneNumber || '',
            map_link: `https://maps.google.com/?q=${plat},${plng}`,
            score: scored.score,
            reason: scored.reason,
            source: 'places-api-v1',
          });
        }
      } catch (e) {
        console.log(`[warn] ${requestId} type=${type} ${e.message}`);
      }
      await sleep(250);
    }

    const dedup = new Map();
    for (const c of all) {
      if (!dedup.has(c.place_id)) dedup.set(c.place_id, c);
      else if ((c.score || 0) > (dedup.get(c.place_id).score || 0)) dedup.set(c.place_id, c);
    }

    const candidates = [...dedup.values()]
      .filter((x) => Number(x.score || 0) >= MIN_SCORE)
      .sort((a, b) => (Number(b.score || 0) - Number(a.score || 0)) || (Number(a.distance_m || 0) - Number(b.distance_m || 0)))
      .slice(0, Math.max(1, MAX_CANDIDATES_PER_REQUEST));

    if (candidates.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: CANDIDATE_SHEET_ID,
        range: `${candSheet}!A2:O`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: candidates.map((c) => [
            c.request_id,
            c.collected_at,
            c.stage,
            c.place_id,
            c.title,
            c.category,
            c.distance_m,
            c.rating,
            c.reviews,
            c.website_url,
            c.phone,
            c.map_link,
            c.score,
            c.reason,
            c.source,
          ]),
        },
      });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: REQUEST_SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `${reqSheet}!C${rowNum}`, values: [['DISCOVERY_DONE']] },
          { range: `${reqSheet}!L${rowNum}`, values: [[`${reqNotes ? reqNotes + ' | ' : ''}engine:done(found:${candidates.length},types:${types.length})`]] },
        ],
      },
    });

    const allCandidates = candidates.map((c, i) => {
      const summary = `${i + 1}) ${c.title} | score:${c.score} | 리뷰:${c.reviews || 0} | ${c.distance_m}m`;
      const mapLine = `   지도: ${c.map_link || '-'}`;
      const idLine = `   place_id: ${c.place_id || '-'}`;
      return [summary, mapLine, idLine].join('\n');
    }).join('\n');

    await sendTelegram([
      '🔎 rewebz 업체 조사 완료',
      `- request: ${requestId}`,
      `- 후보 수: ${candidates.length}`,
      allCandidates ? `- 후보 전체 목록\n${allCandidates}` : '- 후보 없음',
      `- 다음: 승인 시 '승인 ${requestId} <순번>' 또는 place_id로 전달`,
    ].join('\n'));

    processed++;
    console.log(`discovery done request=${requestId} candidates=${candidates.length}`);
  }

  console.log(`discovery-engine done: ${processed}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

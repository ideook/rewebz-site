#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const DISCOVERY_SHEET_ID = process.env.GOOGLE_DISCOVERY_SHEET_ID || '';
const DISCOVERY_SHEET_RANGE = process.env.GOOGLE_DISCOVERY_SHEET_RANGE || 'Discovery!A2:Q';
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

const MAX_REQUESTS = Number(process.env.DISCOVERY_ENGINE_MAX_PER_RUN || 1) || 1;
const MAX_CANDIDATES_PER_REQUEST = Number(process.env.DISCOVERY_MAX_CANDIDATES_PER_REQUEST || 12) || 12;
const MIN_SCORE = Number(process.env.DISCOVERY_MIN_SCORE || 0) || 0;

const HEADERS = [
  'request_id', 'created_at', 'stage', 'lat', 'lng', 'metric_m', 'category', 'title', 'notes', 'map_link',
  'ref_id', 'website_url', 'phone', 'rating', 'reviews', 'score', 'source',
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

function discoverySheetName(range = '') {
  const raw = String(range || '').trim();
  if (!raw.includes('!')) return raw || 'Discovery';
  return raw.split('!')[0] || 'Discovery';
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
  for (const c of categories) {
    const mapped = CATEGORY_TYPE_MAP[c] || [];
    types.push(...mapped);
  }
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

  if (rating > 0 && rating < 4.0) {
    score += 8;
  }

  if (rating >= 4.4 && reviews >= 200 && website) {
    score -= 12;
  }

  return { score, reasons: reasons.join(', ') };
}

async function placesSearchNearby(apiKey, type, center, radius, keyword = '') {
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

  if (keyword) body.rankPreference = 'DISTANCE';

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
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        disable_web_page_preview: true,
      }),
    });
  } catch (_) {}
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!DISCOVERY_SHEET_ID || !SA_EMAIL || !SA_KEY) {
    throw new Error('Missing discovery sheet envs (GOOGLE_DISCOVERY_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY)');
  }

  const placesApiKey = getPlacesApiKey();
  if (!placesApiKey) {
    throw new Error('Missing GOOGLE_PLACES_API_KEY (env) and no fallback goplaces key found');
  }

  const auth = new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const sheetName = discoverySheetName(DISCOVERY_SHEET_RANGE);
  const wholeRange = `${sheetName}!A:Q`;

  // Ensure header
  const headRes = await sheets.spreadsheets.values.get({ spreadsheetId: DISCOVERY_SHEET_ID, range: `${sheetName}!A1:Q1` }).catch(() => ({ data: { values: [] } }));
  const firstCell = String(headRes?.data?.values?.[0]?.[0] || '').trim().toLowerCase();
  if (firstCell !== 'request_id') {
    await sheets.spreadsheets.values.update({
      spreadsheetId: DISCOVERY_SHEET_ID,
      range: `${sheetName}!A1:Q1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });
  }

  const res = await sheets.spreadsheets.values.get({ spreadsheetId: DISCOVERY_SHEET_ID, range: wholeRange });
  const rows = res.data.values || [];

  const requestRows = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const requestId = String(r[0] || '').trim();
    const stage = String(r[2] || '').trim();
    const source = String(r[16] || '').trim();

    if (args.requestId && requestId !== args.requestId) continue;
    if (!requestId.startsWith('rwzd_')) continue;
    if (!['DISCOVERY_NEW', 'DISCOVERY_RETRY'].includes(stage)) continue;
    if (source && source !== 'intake') continue;

    requestRows.push({ rowNum: i + 1, row: r });
  }

  const targets = requestRows.slice(0, Math.max(1, MAX_REQUESTS));
  let processed = 0;

  for (const target of targets) {
    const r = target.row;
    const rowNum = target.rowNum;

    const requestId = String(r[0] || '').trim();
    const center = {
      lat: toNum(r[3], NaN),
      lng: toNum(r[4], NaN),
    };
    const radius = Math.max(300, Math.min(10000, toNum(r[5], 2000)));
    const categories = parseCategories(r[6]);
    const keyword = String(r[7] || '').trim();
    const reqNotes = String(r[8] || '').trim();

    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: DISCOVERY_SHEET_ID,
        range: `${sheetName}!C${rowNum}`,
        valueInputOption: 'RAW',
        requestBody: { values: [['DISCOVERY_ERROR']] },
      });
      continue;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: DISCOVERY_SHEET_ID,
      range: `${sheetName}!C${rowNum}`,
      valueInputOption: 'RAW',
      requestBody: { values: [['DISCOVERY_COLLECTING']] },
    });

    const types = mapTypesFromCategories(categories);
    const existingPlaceIds = new Set(
      rows
        .filter((x, idx) => idx > 0 && String(x?.[0] || '').trim() === requestId)
        .map((x) => String(x?.[10] || '').trim())
        .filter(Boolean),
    );

    const all = [];
    for (const type of types) {
      try {
        const found = await placesSearchNearby(placesApiKey, type, center, radius, keyword);
        for (const p of found) {
          if (!p?.id) continue;
          if (existingPlaceIds.has(p.id)) continue;
          const d = haversineM(center.lat, center.lng, Number(p.location?.latitude || center.lat), Number(p.location?.longitude || center.lng));
          const scored = calcScore(p);
          all.push({
            requestId,
            created_at: new Date().toISOString(),
            stage: 'FOUND',
            lat: Number(p.location?.latitude || center.lat),
            lng: Number(p.location?.longitude || center.lng),
            metric_m: d,
            category: p.primaryType || type,
            title: p.displayName?.text || '(이름없음)',
            notes: scored.reasons,
            map_link: p.googleMapsUri || `https://maps.google.com/?q=${p.location?.latitude || center.lat},${p.location?.longitude || center.lng}`,
            ref_id: p.id,
            website_url: p.websiteUri || '',
            phone: p.nationalPhoneNumber || '',
            rating: p.rating ?? '',
            reviews: p.userRatingCount ?? '',
            score: scored.score,
            source: 'places-api-v1',
          });
        }
      } catch (e) {
        console.log(`[warn] ${requestId} type=${type} ${e.message}`);
      }
      await sleep(250);
    }

    // dedupe within this run
    const dedup = new Map();
    for (const x of all) {
      if (!dedup.has(x.ref_id)) dedup.set(x.ref_id, x);
      else {
        const prev = dedup.get(x.ref_id);
        if ((x.score || 0) > (prev.score || 0)) dedup.set(x.ref_id, x);
      }
    }

    const candidates = [...dedup.values()]
      .filter((x) => Number(x.score || 0) >= MIN_SCORE)
      .sort((a, b) => (Number(b.score || 0) - Number(a.score || 0)) || (Number(a.metric_m || 0) - Number(b.metric_m || 0)))
      .slice(0, Math.max(1, MAX_CANDIDATES_PER_REQUEST));

    if (candidates.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: DISCOVERY_SHEET_ID,
        range: `${sheetName}!A2:Q`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: candidates.map((c) => [
            c.requestId,
            c.created_at,
            c.stage,
            c.lat,
            c.lng,
            c.metric_m,
            c.category,
            c.title,
            c.notes,
            c.map_link,
            c.ref_id,
            c.website_url,
            c.phone,
            c.rating,
            c.reviews,
            c.score,
            c.source,
          ]),
        },
      });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: DISCOVERY_SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `${sheetName}!C${rowNum}`, values: [['DISCOVERY_DONE']] },
          { range: `${sheetName}!I${rowNum}`, values: [[`${reqNotes ? reqNotes + ' | ' : ''}engine:done(found:${candidates.length},types:${types.length})`]] },
        ],
      },
    });

    const top = candidates.slice(0, 5).map((c, i) => `${i + 1}) ${c.title} | score:${c.score} | 리뷰:${c.reviews || 0} | ${c.metric_m}m`).join('\n');
    await sendTelegram([
      '🔎 rewebz 업체 조사 완료',
      `- request: ${requestId}`,
      `- 후보 수: ${candidates.length}`,
      `- 좌표: ${center.lat.toFixed(6)}, ${center.lng.toFixed(6)} (r=${radius}m)`,
      top ? `- 상위 후보\n${top}` : '- 후보 없음',
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

#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { execSync } = require('child_process');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || '시트1!A:N';
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const BASE_DIR = path.resolve(__dirname, '..', 'sites');

function esc(v = '') { return String(v).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])); }
function hash(s = '') { let h = 0; for (const c of s) { h = ((h << 5) - h) + c.charCodeAt(0); h |= 0; } return Math.abs(h); }

function theme(category = '') {
  const c = category.toLowerCase();
  if (c.includes('판매')) return { a: '#ffb37b', b: '#ff6d98', bg: '#1b0f1b' };
  if (c.includes('엔지니어링') || c.includes('제조')) return { a: '#9dffae', b: '#7ea2ff', bg: '#0d1422' };
  return { a: '#8ce9ff', b: '#8ea8ff', bg: '#101a2d' };
}

function cards(goal='') {
  if (/예약|문의|전환/.test(goal)) {
    return [
      ['첫 화면 가치 제안', '핵심 강점을 한 문장으로 압축해 첫 인상을 강화합니다.'],
      ['CTA 흐름 재설계', '상단·중단·하단 문의 유도 동선을 명확하게 구성합니다.'],
      ['신뢰요소 강조', '후기/사례/성과 지표로 의사결정 속도를 높입니다.'],
    ];
  }
  return [
    ['정보 구조 개선', '고객이 원하는 정보를 빠르게 찾는 구조로 재정렬합니다.'],
    ['모바일 우선 최적화', '실사용 환경 중심으로 가독성과 클릭 흐름을 개선합니다.'],
    ['브랜드 톤 정리', '문구와 시각 언어를 통일해 신뢰감을 높입니다.'],
  ];
}

function renderFallback(row) {
  const business = row.business_name || '업체명 미정';
  const category = row.category || '서비스업';
  const region = row.region || '지역 미정';
  const goal = row.goal || '문의 전환율 개선';
  const site = row.website_url || '';
  const t = theme(category);
  const v = hash(`${row.slug}|${business}|${goal}`) % 3;
  const cardHtml = cards(goal).map(([h,p]) => `<article><h3>${esc(h)}</h3><p>${esc(p)}</p></article>`).join('');

  if (v === 0) return `<!doctype html><html lang='ko'><head><meta charset='UTF-8'/><meta name='viewport' content='width=device-width,initial-scale=1'/><title>${esc(business)}</title>
  <style>body{margin:0;background:${t.bg};color:#eef3ff;font-family:system-ui}.w{max-width:1080px;margin:0 auto;padding:42px 20px}.hero{border:1px solid #2a365d;border-radius:22px;padding:26px;background:linear-gradient(145deg,${t.a}22,${t.b}12)}h1{font-size:clamp(34px,6vw,64px);line-height:1.02;margin:12px 0}.a{color:${t.a}}.meta{opacity:.75}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}article{border:1px solid #2a365d;border-radius:14px;padding:12px;background:#101832}h3{margin:0 0 8px}p{margin:0;opacity:.85;line-height:1.5}.btn{display:inline-block;margin-top:14px;background:linear-gradient(90deg,${t.a},${t.b});color:#081322;padding:10px 14px;border-radius:10px;text-decoration:none;font-weight:700}</style>
  </head><body><main class='w'><section class='hero'><div class='meta'>${esc(region)} · ${esc(category)}</div><h1>${esc(business)}<br/><span class='a'>Growth Mockup</span></h1><p>목표: ${esc(goal)}</p><section class='grid'>${cardHtml}</section>${site?`<a class='btn' href='${esc(site)}' target='_blank'>기존 사이트 보기</a>`:''}</section></main></body></html>`;

  if (v === 1) return `<!doctype html><html lang='ko'><head><meta charset='UTF-8'/><meta name='viewport' content='width=device-width,initial-scale=1'/><title>${esc(business)}</title>
  <style>body{margin:0;background:#0b0f18;color:#eef3ff;font-family:system-ui}.band{padding:56px 20px;background:radial-gradient(900px 320px at 20% -20%,${t.a}33,transparent),radial-gradient(900px 320px at 80% -30%,${t.b}33,transparent)}.inner{max-width:1100px;margin:0 auto}.pill{display:inline-block;padding:6px 10px;border:1px solid #33456f;border-radius:999px;font-size:12px;opacity:.8}h1{font-size:clamp(36px,6vw,68px);margin:10px 0 8px}.cards{max-width:1100px;margin:-28px auto 20px;padding:0 20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px}.c{background:#121a31;border:1px solid #33456f;border-radius:14px;padding:14px}.c h3{margin:0 0 8px}.c p{margin:0;opacity:.85}.cta{display:inline-block;margin-top:10px;padding:10px 14px;border-radius:10px;background:${t.a};color:#081322;text-decoration:none;font-weight:700}</style>
  </head><body><header class='band'><div class='inner'><span class='pill'>${esc(region)} · ${esc(category)}</span><h1>${esc(business)}</h1><p>목표: ${esc(goal)}</p>${site?`<a class='cta' href='${esc(site)}' target='_blank'>기존 사이트 보기</a>`:''}</div></header><section class='cards'>${cardHtml.replaceAll('<article>','<article class="c">')}</section></body></html>`;

  return `<!doctype html><html lang='ko'><head><meta charset='UTF-8'/><meta name='viewport' content='width=device-width,initial-scale=1'/><title>${esc(business)}</title>
  <style>body{margin:0;color:#f4f7ff;background:linear-gradient(180deg,#0e1527,#18233f);font-family:system-ui}.w{max-width:980px;margin:0 auto;padding:36px 20px}.top{display:grid;grid-template-columns:1.2fr .8fr;gap:12px}.panel{border:1px solid #30406c;border-radius:16px;padding:16px;background:#0f1832}.title{font-size:clamp(28px,4.8vw,54px);line-height:1.06;margin:8px 0}.kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}.kpi div{border:1px solid #30406c;border-radius:10px;padding:10px;background:#121d3a}.list{margin-top:12px;display:grid;gap:8px}.item{border:1px solid #30406c;border-radius:12px;padding:12px;background:#121d3a}.btn{display:inline-block;margin-top:10px;background:linear-gradient(90deg,${t.a},${t.b});color:#081322;padding:10px 14px;border-radius:10px;text-decoration:none;font-weight:700}</style>
  </head><body><main class='w'><section class='top'><article class='panel'><div>${esc(region)} · ${esc(category)}</div><h1 class='title'>${esc(business)}<br/>Redesign Concept</h1><p>목표: ${esc(goal)}</p>${site?`<a class='btn' href='${esc(site)}' target='_blank'>기존 사이트 보기</a>`:''}</article><aside class='panel'><h3 style='margin:0 0 8px'>핵심 KPI 방향</h3><div class='kpi'><div>신뢰 +18%</div><div>문의 +22%</div><div>이탈 -15%</div></div></aside></section><section class='list'>${cards(goal).map(([h,p])=>`<article class='item'><strong>${esc(h)}</strong><p style='margin:6px 0 0;opacity:.86'>${esc(p)}</p></article>`).join('')}</section></main></body></html>`;
}

async function main() {
  if (!SHEET_ID || !SA_EMAIL || !SA_KEY) throw new Error('Missing Google envs');
  fs.mkdirSync(BASE_DIR, { recursive: true });

  const auth = new google.auth.JWT({ email: SA_EMAIL, key: SA_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: SHEET_RANGE });
  const rows = data.values || [];

  let created = 0, updated = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const status = (r[2] || '').trim();
    const slug = (r[12] || '').trim();
    if (!slug || !['MOCKUP_LIVE', 'READY'].includes(status)) continue;

    const row = {
      id: r[0] || '', business_name: r[3] || '', website_url: r[4] || '',
      category: r[8] || '', region: r[9] || '', goal: r[10] || '', notes: r[11] || '',
      slug, mockup_url: r[13] || ''
    };

    const siteDir = path.join(BASE_DIR, slug);
    const indexPath = path.join(siteDir, 'index.html');
    const briefPath = path.join(siteDir, 'brief.json');
    fs.mkdirSync(siteDir, { recursive: true });

    const prev = fs.existsSync(briefPath) ? JSON.parse(fs.readFileSync(briefPath, 'utf8')) : null;
    const changed = JSON.stringify(prev) !== JSON.stringify(row);
    if (!fs.existsSync(indexPath) || changed) {
      fs.writeFileSync(briefPath, JSON.stringify(row, null, 2));

      let html = '';
      try {
        html = generateWithDesignAgent(row);
      } catch (e) {
        html = '';
      }
      if (!html) html = renderFallback(row);

      fs.writeFileSync(indexPath, html);
      if (prev) updated++; else created++;
      console.log(`${prev ? 'updated' : 'generated'} source for ${slug}`);
    }
  }

  console.log(`generate-site done: created=${created}, updated=${updated}`);
}

function extractHtml(text='') {
  const t = String(text || '').trim();
  const fenced = t.match(/```html\s*([\s\S]*?)```/i) || t.match(/```\s*([\s\S]*?)```/i);
  const html = fenced ? fenced[1].trim() : t;
  if (!/^<!doctype html>|^<html/i.test(html)) return '';
  return html;
}

function generateWithDesignAgent(row) {
  const brief = [
    `업체명: ${row.business_name || ''}`,
    `업종: ${row.category || ''}`,
    `지역: ${row.region || ''}`,
    `목표: ${row.goal || ''}`,
    `기존URL: ${row.website_url || ''}`,
    `slug: ${row.slug || ''}`,
  ].join('\n');

  const prompt = `당신은 웹디자인 전문 에이전트다. 아래 업체 정보를 바탕으로 단 하나의 랜딩페이지를 완전히 새로 설계해 HTML/CSS를 생성하라.\n요구사항:\n- 결과는 완전한 HTML 문서(<!doctype html> 포함)만 출력\n- 인라인 CSS 포함\n- 기존 샘플과 다른 레이아웃/스타일로 창의적으로 제작\n- 한국어 카피\n- CTA 포함\n- 외부 JS 라이브러리 금지\n\n${brief}`;

  const cmd = `openclaw agent --agent design-studio --message ${JSON.stringify(prompt)} --json`;
  const raw = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = JSON.parse(raw);
  const text = parsed?.result?.payloads?.[0]?.text || '';
  return extractHtml(text);
}

main().catch(e => { console.error(e.message); process.exit(1); });

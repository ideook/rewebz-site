#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || '시트1!A:N';
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'rewebz.com';
const BASE_DIR = path.resolve(__dirname, '..', 'sites');

function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}

function hash(s=''){let h=0; for(const c of s){h=((h<<5)-h)+c.charCodeAt(0); h|=0;} return Math.abs(h)}

function pickTheme(category='', goal='') {
  const c = (category || '').toLowerCase();
  if (c.includes('판매')) return { a:'#ffd08a', b:'#ff8fa4', bg:'#1b1220' };
  if (c.includes('엔지니어링') || c.includes('제조')) return { a:'#94ffb8', b:'#7ca8ff', bg:'#0f1725' };
  if ((goal||'').includes('예약') || (goal||'').includes('문의')) return { a:'#8fe9ff', b:'#8ea9ff', bg:'#101a2f' };
  return { a:'#79f3c2', b:'#8aa9ff', bg:'#0d162b' };
}

function render(row){
  const business = row.business_name || '업체명 미정';
  const category = row.category || '서비스업';
  const region = row.region || '지역 미정';
  const goal = row.goal || '문의 전환율 개선';
  const site = row.website_url || '';
  const t = pickTheme(category, goal);

  return `<!doctype html><html lang="ko"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(business)} | mockup</title>
  <style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#eef2ff;background:radial-gradient(700px 300px at 5% -10%,${t.a}33,transparent 60%),radial-gradient(700px 300px at 95% -20%,${t.b}26,transparent 60%),${t.bg}}
  .wrap{max-width:980px;margin:0 auto;padding:44px 20px}
  .hero{border:1px solid #2b3965;border-radius:20px;padding:24px;background:linear-gradient(160deg,#ffffff10,#ffffff05)}
  .badge{display:inline-block;border:1px solid #2b3965;border-radius:999px;padding:6px 10px;color:#adbbdc;font-size:12px}
  h1{font-size:clamp(32px,5vw,56px);line-height:1.05;margin:12px 0}
  .a{color:${t.a}} .lead{color:#aab8d9;line-height:1.6}
  .grid{margin-top:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
  .card{border:1px solid #2b3965;border-radius:14px;padding:14px;background:#101a35}
  .btn{display:inline-block;margin-top:14px;text-decoration:none;padding:11px 14px;border-radius:10px;font-weight:700;background:linear-gradient(90deg,${t.a},${t.b});color:#081223}
  </style></head><body><main class="wrap"><section class="hero"><span class="badge">${esc(region)} · ${esc(category)}</span><h1>${esc(business)} <span class="a">개선 목업</span></h1><p class="lead">목표: ${esc(goal)}</p><div class="grid"><article class="card"><h3>메시지 재정렬</h3><p>첫 화면에서 고객이 핵심 가치를 즉시 이해하게 합니다.</p></article><article class="card"><h3>전환 동선 강화</h3><p>문의/예약 CTA 위치를 최적화해 행동 전환률을 높입니다.</p></article><article class="card"><h3>신뢰 요소 추가</h3><p>후기/사례/핵심지표를 배치해 문의 전 망설임을 줄입니다.</p></article></div>${site?`<a class="btn" href="${esc(site)}" target="_blank" rel="noreferrer">기존 사이트 보기</a>`:''}</section></main></body></html>`;
}

async function main(){
  if(!SHEET_ID||!SA_EMAIL||!SA_KEY) throw new Error('Missing Google envs');
  fs.mkdirSync(BASE_DIR,{recursive:true});

  const auth = new google.auth.JWT({ email: SA_EMAIL, key: SA_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version:'v4', auth });
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: SHEET_RANGE });
  const rows = data.values || [];
  let created = 0;

  for(let i=1;i<rows.length;i++){
    const r=rows[i];
    const status=(r[2]||'').trim();
    const id=r[0]||'';
    const business_name=r[3]||'';
    const website_url=r[4]||'';
    const category=r[8]||'';
    const region=r[9]||'';
    const goal=r[10]||'';
    const notes=r[11]||'';
    const slug=(r[12]||'').trim();
    const mockup_url=(r[13]||'').trim();

    if(!slug || !['MOCKUP_LIVE','READY'].includes(status)) continue;

    const siteDir = path.join(BASE_DIR, slug);
    const indexPath = path.join(siteDir, 'index.html');
    if (fs.existsSync(indexPath)) continue;

    const row = { id, business_name, website_url, category, region, goal, notes, slug, mockup_url };
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'brief.json'), JSON.stringify(row, null, 2));
    fs.writeFileSync(indexPath, render(row));

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `시트1!L${i+1}`, values: [[`${notes ? notes + ' | ' : ''}source:generated`]] },
        ],
      },
    });

    created++;
    console.log(`generated source for ${slug}`);
  }

  console.log(`generate-site done: ${created}`);
}

main().catch(e=>{console.error(e.message);process.exit(1);});

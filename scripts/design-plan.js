#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || '시트1!A:N';
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const BASE_DIR = path.resolve(__dirname, '..', 'sites');
const MAX_PER_RUN = Number(process.env.DESIGN_PLAN_MAX_PER_RUN || 1);

function callDesignAgent(brief) {
  const prompt = [
    '너는 디자인 기획 전담 에이전트다.',
    '코드를 만들지 말고, 반드시 Markdown 기획서만 작성한다.',
    '출력 형식: DESIGN_SPEC.md',
    '핵심 디자인 방향(반드시 반영):',
    '- 원페이지(one-page) 구성으로 설계한다.',
    '- 상단에는 메뉴를 2~3개(예: 소개, 특징, 문의) 배치한다.',
    '- 히어로 섹션은 크게 구성하고, 사진/이미지가 메인 비주얼로 크게 들어간다.',
    '- 중단에는 특징/장점 섹션이 명확히 보이도록 구성한다.',
    '- 하단에는 자세한 설명(프로세스/FAQ/상세안내) 섹션을 넣는다.',
    '- 최하단에는 footer를 포함한다.',
    '',
    '포함 섹션:',
    '1) 브랜드 포지션/톤',
    '2) 핵심 사용자와 시나리오',
    '3) 정보구조(IA)와 페이지 섹션 순서 (상단 메뉴 + 대형 히어로 + 특징/장점 + 상세설명 + footer)',
    '4) 시각 시스템(컬러/타이포/레이아웃/모션)',
    '5) 카피 전략(헤드라인 3안, CTA 5안)',
    '6) 개발 handoff 체크리스트',
    '',
    '업체 입력:',
    brief,
  ].join('\n');

  const cmd = `openclaw agent --agent design-studio --thinking high --message ${JSON.stringify(prompt)} --json`;
  const raw = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = JSON.parse(raw);
  return (parsed?.result?.payloads?.[0]?.text || '').trim();
}

async function main() {
  if (!SHEET_ID || !SA_EMAIL || !SA_KEY) throw new Error('Missing Google envs');
  fs.mkdirSync(BASE_DIR, { recursive: true });

  const auth = new google.auth.JWT({ email: SA_EMAIL, key: SA_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: SHEET_RANGE });

  const rows = data.values || [];
  let planned = 0;

  for (let i = 1; i < rows.length; i++) {
    if (planned >= MAX_PER_RUN) break;
    const r = rows[i];
    const status = (r[2] || '').trim();
    const id = r[0] || '';
    const business = r[3] || '';
    const website = r[4] || '';
    const category = r[8] || '';
    const region = r[9] || '';
    const goal = r[10] || '';
    const notes = r[11] || '';
    const slug = (r[12] || '').trim();

    if (!slug) continue;
    // Stage 2 pipeline: design agent only processes DNS-complete rows.
    if (status !== 'DNS_DONE') continue;

    const siteDir = path.join(BASE_DIR, slug);
    const specPath = path.join(siteDir, 'DESIGN_SPEC.md');
    if (fs.existsSync(specPath)) continue;

    fs.mkdirSync(siteDir, { recursive: true });

    const brief = [
      `requestId: ${id}`,
      `business_name: ${business}`,
      `category: ${category}`,
      `region: ${region}`,
      `goal: ${goal}`,
      `website_url: ${website}`,
      `notes: ${notes}`,
      `slug: ${slug}`,
    ].join('\n');

    let spec = '';
    try {
      spec = callDesignAgent(brief);
    } catch (e) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: `시트1!C${i + 1}`, values: [['DESIGN_ERROR']] },
            { range: `시트1!L${i + 1}`, values: [[`${notes ? notes + ' | ' : ''}design:error:${String(e.message).slice(0,120)}`]] },
          ],
        },
      });
      continue;
    }

    if (!spec.startsWith('#')) spec = `# DESIGN_SPEC\n\n${spec}`;

    // force required implementation contract for dev stage
    spec += `\n\n## REQUIRED_IMPLEMENTATION_IDS\n- nav menu links: #intro, #features, #contact (2~3개)\n- hero section id: #hero\n- features section id: #features\n- details section id: #details\n- contact section id: #contact\n- footer required\n- hero must include a large image element\n`;

    fs.writeFileSync(specPath, spec + '\n');

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `시트1!C${i + 1}`, values: [['DESIGN_DONE']] },
          { range: `시트1!L${i + 1}`, values: [[`${notes ? notes + ' | ' : ''}design-spec:done(gpt-5.3)`]] },
        ],
      },
    });

    planned++;
    console.log(`design spec ready for ${slug}`);
  }

  console.log(`design-plan done: ${planned}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

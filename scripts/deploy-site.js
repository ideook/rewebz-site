#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASE_DIR = path.join(ROOT, 'sites');
const out = path.join(ROOT, 'logs', 'deploy-queue.log');
const manifestPath = path.join(BASE_DIR, '_manifest.json');
const AUTO_GIT_PUSH = (process.env.AUTO_GIT_PUSH || '1') === '1';

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function main() {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!fs.existsSync(BASE_DIR)) { console.log('deploy-site: no sites dir'); return; }

  const slugs = fs.readdirSync(BASE_DIR)
    .filter(x => fs.statSync(path.join(BASE_DIR, x)).isDirectory())
    .filter(x => !x.startsWith('_'));

  const items = slugs.map(slug => {
    const brief = path.join(BASE_DIR, slug, 'brief.json');
    const index = path.join(BASE_DIR, slug, 'index.html');
    let meta = {};
    if (fs.existsSync(brief)) {
      try { meta = JSON.parse(fs.readFileSync(brief, 'utf8')); } catch (_) {}
    }
    return {
      slug,
      business_name: meta.business_name || '',
      category: meta.category || '',
      region: meta.region || '',
      goal: meta.goal || '',
      mockup_url: meta.mockup_url || `https://${slug}.rewebz.com`,
      updated_at: fs.existsSync(index) ? fs.statSync(index).mtime.toISOString() : new Date().toISOString(),
    };
  }).sort((a, b) => a.updated_at < b.updated_at ? 1 : -1);

  fs.writeFileSync(manifestPath, JSON.stringify({ generated_at: new Date().toISOString(), count: items.length, items }, null, 2));

  const line = `[${new Date().toISOString()}] deploy-check slugs=${slugs.length} manifest=ok\n`;
  fs.appendFileSync(out, line);

  if (AUTO_GIT_PUSH) {
    try {
      const status = sh('git status --porcelain');
      if (status) {
        sh('git add sites _manifest.json . 2>/dev/null || true');
        sh('git add sites/_manifest.json scripts logs/deploy-queue.log .gitignore 2>/dev/null || true');
        sh('git commit -m "chore: autobuild site updates"');
        sh('git push');
      }
    } catch (e) {
      fs.appendFileSync(out, `[${new Date().toISOString()}] git-sync-fail\n`);
    }
  }

  console.log('deploy-site done');
}

main();

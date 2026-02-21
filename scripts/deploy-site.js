#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASE_DIR = path.join(ROOT, 'sites');
const out = path.join(ROOT, 'logs', 'deploy-queue.log');
const manifestPath = path.join(BASE_DIR, '_manifest.json');
const AUTO_GIT_PUSH = (process.env.AUTO_GIT_PUSH || '1') === '1';
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'rewebz.com';
const TENANT_ROOT_DOMAIN = process.env.TENANT_ROOT_DOMAIN || ROOT_DOMAIN;
const BUILD_MARKER_NAME = 'rewebz-build-marker';

function markerContent(slug = '') {
  return `rwz-live-v2:${slug}`;
}

function ensureBuildMarker(html = '', slug = '') {
  const marker = markerContent(slug);
  const tag = `<meta name="${BUILD_MARKER_NAME}" content="${marker}" data-rwz-hidden="1" />`;

  if (new RegExp(`<meta[^>]*name=["']${BUILD_MARKER_NAME}["']`, 'i').test(html)) {
    return html.replace(
      new RegExp(`(<meta[^>]*name=["']${BUILD_MARKER_NAME}["'][^>]*content=["'])[^"']*(["'][^>]*>)`, 'i'),
      `$1${marker}$2`,
    );
  }

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}\n  ${tag}`);
  }

  return `${tag}\n${html}`;
}

function ensureBuildMarkerInFile(indexPath, slug) {
  if (!fs.existsSync(indexPath)) return false;
  const raw = fs.readFileSync(indexPath, 'utf8');
  const next = ensureBuildMarker(raw, slug);
  if (next === raw) return false;
  fs.writeFileSync(indexPath, next);
  return true;
}

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function logLine(msg) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.appendFileSync(out, `[${new Date().toISOString()}] ${msg}\n`);
}

function safeErr(err) {
  const msg = String(err?.stderr || err?.message || err || '').replace(/\s+/g, ' ').trim();
  return msg.slice(0, 400) || 'unknown';
}

function originUrl() {
  try {
    return sh('git remote get-url origin');
  } catch {
    return '';
  }
}

function httpsGithubToSsh(url = '') {
  const m = String(url).match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!m) return '';
  return `git@github.com:${m[1]}/${m[2]}.git`;
}

function gitSync() {
  if (!AUTO_GIT_PUSH) {
    logLine('git-sync-skip auto=0');
    return;
  }
  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    logLine('git-sync-skip no-git-repo');
    return;
  }

  const status = sh('git status --porcelain');
  if (!status) {
    logLine('git-sync-skip clean');
    return;
  }

  // Stage generated tenant sources + manifest only.
  // NOTE: avoid invalid pathspecs (e.g. root _manifest.json) because they cause add to fail.
  sh('git add -A sites sites/_manifest.json 2>/dev/null || true');

  const staged = sh('git diff --cached --name-only');
  if (!staged) {
    logLine('git-sync-skip nothing-staged');
    return;
  }

  sh('git commit -m "chore: autobuild site updates"');

  try {
    sh('git push --porcelain');
    logLine('git-sync-ok push');
  } catch (e1) {
    const err1 = safeErr(e1);

    // Auto-heal common non-interactive auth failure on HTTPS remotes.
    if (/could not read username for 'https:\/\/github\.com'/i.test(err1)) {
      const current = originUrl();
      const sshUrl = httpsGithubToSsh(current);
      if (sshUrl) {
        try {
          sh(`git remote set-url origin ${JSON.stringify(sshUrl)}`);
          sh('git push --porcelain');
          logLine(`git-sync-ok push-via-ssh origin=${sshUrl}`);
          return;
        } catch (eSsh) {
          logLine(`git-sync-fail ${safeErr(eSsh)}`);
          throw eSsh;
        }
      }
    }

    // First push on a branch may require upstream linkage.
    const branch = sh('git rev-parse --abbrev-ref HEAD') || 'main';
    try {
      sh(`git push --set-upstream origin ${branch} --porcelain`);
      logLine(`git-sync-ok push-set-upstream:${branch}`);
    } catch (e2) {
      logLine(`git-sync-fail ${safeErr(e2)}`);
      throw e2;
    }
  }
}

function main() {
  if (!fs.existsSync(BASE_DIR)) {
    console.log('deploy-site: no sites dir');
    return;
  }

  const slugs = fs.readdirSync(BASE_DIR)
    .filter((x) => fs.statSync(path.join(BASE_DIR, x)).isDirectory())
    .filter((x) => !x.startsWith('_'));

  let markerPatched = 0;
  const items = slugs
    .map((slug) => {
      const brief = path.join(BASE_DIR, slug, 'brief.json');
      const index = path.join(BASE_DIR, slug, 'index.html');
      if (ensureBuildMarkerInFile(index, slug)) markerPatched++;
      let meta = {};
      if (fs.existsSync(brief)) {
        try {
          meta = JSON.parse(fs.readFileSync(brief, 'utf8'));
        } catch (_) {}
      }
      return {
        slug,
        business_name: meta.business_name || '',
        category: meta.category || '',
        region: meta.region || '',
        goal: meta.goal || '',
        mockup_url: meta.mockup_url || `https://${slug}.${TENANT_ROOT_DOMAIN}`,
        updated_at: fs.existsSync(index)
          ? fs.statSync(index).mtime.toISOString()
          : new Date().toISOString(),
      };
    })
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));

  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ generated_at: new Date().toISOString(), count: items.length, items }, null, 2),
  );

  logLine(`deploy-check slugs=${slugs.length} manifest=ok marker_patched=${markerPatched}`);

  try {
    gitSync();
  } catch {
    // keep process alive; failure details are already logged
  }

  console.log('deploy-site done');
}

main();

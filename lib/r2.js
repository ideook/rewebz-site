const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');

function getR2Config() {
  const enabled = (process.env.R2_ENABLED || '0') === '1';
  const accountId = process.env.R2_ACCOUNT_ID || '';
  const bucket = process.env.R2_BUCKET || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const keyPrefix = (process.env.R2_KEY_PREFIX || 'sites').replace(/^\/+|\/+$/g, '');

  return {
    enabled,
    accountId,
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint,
    keyPrefix,
    ready: enabled && !!(accountId && bucket && accessKeyId && secretAccessKey && endpoint),
  };
}

function r2EnabledAndReady() {
  const cfg = getR2Config();
  return cfg.enabled && cfg.ready;
}

function createS3Client(cfg = getR2Config()) {
  if (!cfg.ready) throw new Error('R2 not configured');
  return new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: true,
  });
}

function keyForVersion(slug, version, cfg = getR2Config()) {
  return `${cfg.keyPrefix}/${slug}/${version}/index.html`;
}

function keyForLivePointer(slug, cfg = getR2Config()) {
  return `${cfg.keyPrefix}/${slug}/_live.json`;
}

function makeVersion() {
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function bodyToString(body) {
  if (!body) return '';
  if (typeof body.transformToString === 'function') {
    return body.transformToString();
  }
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function putObject({ key, body, contentType = 'application/octet-stream' }, cfg = getR2Config()) {
  const client = createS3Client(cfg);
  await client.send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

async function uploadSiteHtml(slug, html, options = {}, cfg = getR2Config()) {
  if (!cfg.ready) throw new Error('R2 not configured');

  const version = options.version || makeVersion();
  const htmlKey = keyForVersion(slug, version, cfg);
  const pointerKey = keyForLivePointer(slug, cfg);

  await putObject({ key: htmlKey, body: html, contentType: 'text/html; charset=utf-8' }, cfg);
  await putObject({
    key: pointerKey,
    body: JSON.stringify({
      slug,
      version,
      key: htmlKey,
      updated_at: new Date().toISOString(),
    }, null, 2),
    contentType: 'application/json; charset=utf-8',
  }, cfg);

  return { version, htmlKey, pointerKey };
}

async function getObjectString(key, cfg = getR2Config()) {
  const client = createS3Client(cfg);
  const out = await client.send(new GetObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
  }));
  return bodyToString(out.Body);
}

async function headObjectExists(key, cfg = getR2Config()) {
  const client = createS3Client(cfg);
  try {
    await client.send(new HeadObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
    }));
    return true;
  } catch {
    return false;
  }
}

async function getLivePointer(slug, cfg = getR2Config()) {
  if (!cfg.ready) return null;
  const pointerKey = keyForLivePointer(slug, cfg);
  try {
    const raw = await getObjectString(pointerKey, cfg);
    const j = JSON.parse(raw || '{}');
    if (!j?.key || !j?.version) return null;
    return j;
  } catch {
    return null;
  }
}

async function getLiveHtmlForSlug(slug, cfg = getR2Config()) {
  if (!cfg.ready) return null;

  const pointer = await getLivePointer(slug, cfg);
  if (pointer?.key) {
    try {
      const html = await getObjectString(pointer.key, cfg);
      if (html) return { html, version: pointer.version, key: pointer.key };
    } catch (_) {}
  }

  // compatibility fallback: old key style
  const legacyKey = `${cfg.keyPrefix}/${slug}/index.html`;
  try {
    const html = await getObjectString(legacyKey, cfg);
    if (html) return { html, version: 'legacy', key: legacyKey };
  } catch (_) {}

  return null;
}

async function hasLiveSiteSource(slug, cfg = getR2Config()) {
  if (!cfg.ready) return false;
  const pointer = await getLivePointer(slug, cfg);
  if (!pointer?.key) return false;
  return headObjectExists(pointer.key, cfg);
}

module.exports = {
  getR2Config,
  r2EnabledAndReady,
  makeVersion,
  keyForVersion,
  keyForLivePointer,
  uploadSiteHtml,
  getLivePointer,
  getLiveHtmlForSlug,
  hasLiveSiteSource,
};

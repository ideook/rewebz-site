#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const BASE_DIR = path.resolve(__dirname, '..', 'sites');
const out = path.resolve(__dirname, '..', 'logs', 'deploy-queue.log');

function main(){
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if(!fs.existsSync(BASE_DIR)){ console.log('deploy-site: no sites dir'); return; }
  const slugs = fs.readdirSync(BASE_DIR).filter(x=>fs.statSync(path.join(BASE_DIR,x)).isDirectory());
  const line = `[${new Date().toISOString()}] deploy-check slugs=${slugs.length}\n`;
  fs.appendFileSync(out, line);
  console.log('deploy-site done');
}

main();

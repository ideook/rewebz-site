#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const BASE_DIR = path.resolve(__dirname, '..', 'sites');

function main(){
  if(!fs.existsSync(BASE_DIR)){ console.log('qa-site: no sites dir'); return; }
  const slugs = fs.readdirSync(BASE_DIR).filter(x=>fs.statSync(path.join(BASE_DIR,x)).isDirectory());
  let ok=0, fail=0;
  for(const slug of slugs){
    const p = path.join(BASE_DIR, slug, 'index.html');
    if(!fs.existsSync(p)){ console.log(`FAIL ${slug}: missing index.html`); fail++; continue; }
    const html = fs.readFileSync(p,'utf8');
    if(!html.includes('<title>') || html.length < 1200){ console.log(`FAIL ${slug}: weak content`); fail++; continue; }
    ok++;
  }
  console.log(`qa-site done: ok=${ok}, fail=${fail}`);
  if(fail>0) process.exit(2);
}

main();

/**
 * Download the approved raw sound files (exactly the URLs in docs/audio/sfx-manifest.md) into the
 * raw folder, outside the repo. Each URL is tried twice; failures are listed at the end. Kenney zips
 * are unpacked next to themselves. Existing files are kept.
 *
 *   npx tsx scripts/sfx-fetch.ts            (SFX_RAW=/path to override the folder)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_RAW, parseManifest } from './sfx-sources';

const RAW = process.env.SFX_RAW ?? DEFAULT_RAW;

async function get(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'lofi-ops-sfx-fetch/1' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const failed: { file: string; url: string; err: string }[] = [];
let bytes = 0;
for (const s of parseManifest()) {
  const path = join(RAW, s.file);
  if (existsSync(path) && statSync(path).size > 0) {
    bytes += statSync(path).size;
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  let err = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const buf = await get(s.url);
      writeFileSync(path, buf);
      bytes += buf.length;
      console.log(`ok   ${s.file}  ${(buf.length / 1024).toFixed(0)} KB`);
      err = '';
      break;
    } catch (e) {
      err = String((e as Error).message ?? e);
      console.log(`fail ${s.file} (attempt ${attempt + 1}): ${err}`);
    }
  }
  if (err) failed.push({ file: s.file, url: s.url, err });
  else if (s.file.endsWith('.zip')) execFileSync('unzip', ['-o', '-q', path, '-d', path.replace(/\.zip$/, '')]);
}
console.log(`\n${(bytes / 1048576).toFixed(1)} MB in ${RAW}`);
if (failed.length) {
  console.log(`${failed.length} failed:`);
  for (const f of failed) console.log(`  ${f.file}  ${f.err}  ${f.url}`);
}

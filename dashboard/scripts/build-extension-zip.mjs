/**
 * Rebuilds dashboard/public/downloads/LinkedFlow-Chrome-Extension.zip
 * from the chrome-extension/ folder at the repo root.
 *
 * Runs automatically before every `npm run build` so the downloaded ZIP
 * always matches the latest committed extension code.
 */
import { createWriteStream, mkdirSync, readdirSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot   = join(__dirname, '..', '..');          // linkedin-bot/
const extDir     = join(repoRoot, 'chrome-extension');
const outDir     = join(__dirname, '..', 'public', 'downloads');
const outZip     = join(outDir, 'LinkedFlow-Chrome-Extension.zip');

// On Vercel the monorepo root may not be available — skip gracefully so the
// previously committed ZIP is used instead of failing the whole build.
import { existsSync } from 'fs';
if (!existsSync(extDir)) {
  console.log('ℹ️  chrome-extension/ not found (Vercel build context) — using committed ZIP.');
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

// Pure-JS ZIP writer (no external deps needed)
function toU8(str) {
  return new TextEncoder().encode(str);
}

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })());
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function le16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; }
function le32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; }

function dosDateTime() {
  const d = new Date();
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return { date, time };
}

function collectFiles(dir, base = '') {
  const results = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel  = base ? `${base}/${name}` : name;
    if (statSync(full).isDirectory()) {
      results.push(...collectFiles(full, rel));
    } else {
      results.push({ full, rel });
    }
  }
  return results;
}

const files   = collectFiles(extDir);
const entries = [];
let   offset  = 0;
const chunks  = [];

for (const { full, rel } of files) {
  const { readFileSync } = await import('fs');
  const data     = readFileSync(full);
  const nameBuf  = Buffer.from(rel);  // no extra folder prefix — manifest.json sits at ZIP root
  const crc      = crc32(data);
  const { date, time } = dosDateTime();

  // Local file header
  const lh = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),  // signature
    le16(20),          // version needed
    le16(0),           // flags
    le16(0),           // compression (stored)
    le16(time),
    le16(date),
    le32(crc),
    le32(data.length),
    le32(data.length),
    le16(nameBuf.length),
    le16(0),           // extra length
    nameBuf,
  ]);

  entries.push({ nameBuf, crc, size: data.length, date, time, offset });
  chunks.push(lh, data);
  offset += lh.length + data.length;
}

// Central directory
const cdChunks = [];
for (const e of entries) {
  const cd = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x01, 0x02]),
    le16(20), le16(20), le16(0), le16(0),
    le16(e.time), le16(e.date),
    le32(e.crc),
    le32(e.size), le32(e.size),
    le16(e.nameBuf.length), le16(0), le16(0), le16(0), le16(0),
    le32(0),
    le32(e.offset),
    e.nameBuf,
  ]);
  cdChunks.push(cd);
}
const cdBuf    = Buffer.concat(cdChunks);
const cdOffset = offset;

const eocd = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  le16(0), le16(0),
  le16(entries.length), le16(entries.length),
  le32(cdBuf.length),
  le32(cdOffset),
  le16(0),
]);

const ws = createWriteStream(outZip);
for (const c of [...chunks, cdBuf, eocd]) ws.write(c);
ws.end();
ws.on('finish', () => {
  const kb = (statSync(outZip).size / 1024).toFixed(1);
  console.log(`✅ Built LinkedFlow-Chrome-Extension.zip (${kb} KB)`);
});

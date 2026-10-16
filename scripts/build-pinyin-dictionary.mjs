import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Reproducible third-party data transformation, not hand-authored application code.
const commit = '49aebad1c1cfbbcaa9288ffed5161e79e57c3679';
const origin = `https://android.googlesource.com/platform/packages/inputmethods/PinyinIME/+/${commit}/`;
const read = async file => {
  const response = await fetch(`${origin}${file}?format=TEXT`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`词库来源返回 ${response.status}`);
  return Buffer.from(await response.text(), 'base64');
};
const raw = await read('jni/data/rawdict_utf16_65105_freq.txt');
const entries = raw.toString('utf16le').replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  .map(line => line.trim().split(/\s+/))
  .filter(parts => parts[2] === '0' && parts.length >= 4)
  .map(parts => ({ text: parts[0], frequency: Number(parts[1]), pinyin: parts.slice(3).join('').replace(/ü/g, 'v') }))
  .filter(entry => /^[a-zv]+$/.test(entry.pinyin))
  .sort((a, b) => b.frequency - a.frequency);
const directory = 'public/ime';
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/pinyin.json`, JSON.stringify(entries.map(entry => [entry.text, entry.pinyin])));
await writeFile(`${directory}/NOTICE.txt`, await read('NOTICE'));
await writeFile(`${directory}/SOURCE.json`, JSON.stringify({
  origin: `${origin}jni/data/rawdict_utf16_65105_freq.txt`, commit,
  sha256: createHash('sha256').update(raw).digest('hex'),
  entries: entries.length, license: 'Apache-2.0',
  changes: 'UTF-16 to JSON; simplified entries only; frequency descending; joined syllables',
}, null, 2));
console.log(JSON.stringify({ entries: entries.length, directory }));

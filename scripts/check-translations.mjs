import fs from 'node:fs';
const base = new URL('../src/', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, base), 'utf8').replace(/^\uFEFF/, '');
const dict = { ...JSON.parse(read('locales/ar.json')), ...JSON.parse(read('locales/web-ar.json')) },
  keys = new Set();
for (const file of fs.readdirSync(base).filter((x) => /tsx?$/.test(x) && !x.includes('.test.'))) {
  const source = read(file);
  for (const match of source.matchAll(/\bt\(/g)) {
    let depth = 1,
      i = match.index + 2;
    for (; i < source.length && depth; i++) {
      const c = source[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === '"' || c === "'") {
        let text = '';
        for (i++; i < source.length; i++) {
          if (source[i] === '\\') {
            text += source[++i];
            continue;
          }
          if (source[i] === c) break;
          text += source[i];
        }
        keys.add(text);
      }
    }
  }
  for (const m of source.matchAll(/(?:label|title|hint)="([^"]+)"/g)) keys.add(m[1]);
  for (const m of source.matchAll(/label:\s*'([^']+)'/g)) keys.add(m[1]);
}
const skip = [
  'doctor',
  'assistant',
  'signin',
  'signup',
  'reset',
  'date',
  'scheduled',
  'confirmed',
  'arrived',
  'waiting',
  'withDoctor',
  'completed',
  'cancelled',
  'noShow',
  'details',
  'consultation',
  'history',
  'documents',
  'send',
  'archived',
  'status',
];
const missing = [...keys].filter((k) => !dict[k] && k.length > 1 && !skip.includes(k)).sort();
console.log(JSON.stringify(missing, null, 2));
if (missing.length) process.exitCode = 1;

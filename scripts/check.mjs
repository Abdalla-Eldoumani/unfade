// Quick checks that need no browser: every bundled memory matches the
// contract, the room state rules behave, and the Claude call is shaped right
// (against a fake API, so no key or network is needed). Run: npm run check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MSG, applyToState, emptyRoomState, envelope, normalizeMemory, validateMemory } from '../src/shared/contract.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let failed = 0;
const ok = (name) => console.log(`ok    ${name}`);
const fail = (name, why) => {
  failed++;
  console.log(`FAIL  ${name}: ${why}`);
};

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpegSize(file) {
  const b = fs.readFileSync(file);
  let i = 2;
  while (i < b.length) {
    const marker = b.readUInt16BE(i);
    const len = b.readUInt16BE(i + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the size
    if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error('no frame header');
}

// ---- bundled memories ------------------------------------------------------
const dir = path.join(root, 'public', 'memories');
const ids = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).memories;
for (const id of ids) {
  const name = `memory ${id}`;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, id, 'memory.json'), 'utf8'));
    const spec = normalizeMemory(raw);
    const errors = validateMemory(spec);
    if (spec.id !== id) errors.push(`id ${spec.id} does not match its folder`);
    for (const key of ['photo', 'thumb', 'depth']) {
      const file = path.join(dir, id, spec[key].src);
      if (!fs.existsSync(file)) {
        errors.push(`${key} file ${spec[key].src} is missing`);
        continue;
      }
      const size = key === 'depth' ? pngSize(file) : jpegSize(file);
      if (size.width !== spec[key].width || size.height !== spec[key].height) {
        errors.push(`${key} is ${size.width}x${size.height} but memory.json says ${spec[key].width}x${spec[key].height}`);
      }
    }
    if (errors.length) fail(name, errors.join('; '));
    else ok(name);
  } catch (err) {
    fail(name, err.message);
  }
}

// ---- room state --------------------------------------------------------------
{
  const s = emptyRoomState();
  applyToState(s, envelope(MSG.ANCHOR_BLOOM, { memoryId: 'the-cat', anchorId: 'a1' }));
  applyToState(s, envelope(MSG.ANCHOR_BLOOM, { memoryId: 'the-cat', anchorId: 'a1' }));
  applyToState(s, envelope(MSG.NOTE_ADD, { memoryId: 'the-cat', anchorId: 'a1', text: '  slept on the radiator ', author: 'Omar' }));
  applyToState(s, envelope(MSG.ANCHOR_BLOOM, { memoryId: '../etc', anchorId: 'a1' }));
  const good = s.blooms['the-cat']?.length === 1 && s.notes['the-cat']?.[0].text === 'slept on the radiator' && !s.blooms['../etc'];
  applyToState(s, envelope(MSG.MEMORY_RESET, { memoryId: null }));
  if (good && !Object.keys(s.blooms).length && !Object.keys(s.notes).length) ok('room state rules');
  else fail('room state rules', JSON.stringify(s));
}

// ---- the Claude request, against a fake API ----------------------------------
// The assertions live beside claude.js, so its owner changes them together.
try {
  const { checkClaudeRequest } = await import('../server/claude.check.js');
  const problems = await checkClaudeRequest();
  if (problems.length) fail('Claude request shape', problems.join('; '));
  else ok('Claude request shape (fake API)');
} catch (err) {
  fail('Claude request shape', err.message);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);

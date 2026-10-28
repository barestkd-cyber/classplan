/* ============================================================================
 * Kickboxing classes plan with kickboxing segments (Race, 2026-10-28)
 * ----------------------------------------------------------------------------
 * Plain Node, no dependencies. Run from the classplan repo root:
 *     node tests/segments.test.js
 * ========================================================================== */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok   ' + name); passed++; }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + (e && e.message)); failed++; process.exitCode = 1; }
}
function grabConst(name) {
  const i = src.indexOf('const ' + name + ' = [');
  if (i === -1) throw new Error('const ' + name + ' not found');
  return src.slice(i, src.indexOf('];', i) + 2);
}
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('function ' + name + ' not found');
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
  }
  throw new Error('unterminated ' + name);
}

const ctx = vm.createContext({ currentEntry: null });
vm.runInContext([grabConst('CATS'), grabConst('KB_CATS'), grab('segCats'), grab('getCat')].join('\n') +
  '\nthis.CATS = CATS; this.KB_CATS = KB_CATS;', ctx);
const labels = list => Array.from(list, c => c.l); // an array from this realm, not the sandbox's

test("a kickboxing class offers Race's kickboxing segments", () => {
  ctx.currentEntry = { label: 'Kickboxing', program: 'Kickboxing' };
  assert.deepStrictEqual(labels(ctx.segCats()), ['Stretching', 'Review', 'Warm Up', 'Boxing Combos', 'Kick Combos',
    "Hands'n'Feet Combos", 'New Techniques', 'New Combos', 'Cool Down', 'Bag Work', 'Thai Pads']);
});

test('Taekwondo classes keep their own segments', () => {
  ctx.currentEntry = { label: 'Juniors', program: 'Taekwondo' };
  assert.ok(labels(ctx.segCats()).includes('Forms'));
  assert.ok(!labels(ctx.segCats()).includes('Thai Pads'));
});

test('Little Kickers is not kickboxing', () => {
  ctx.currentEntry = { label: 'Little Kickers', program: 'Little Kickers' };
  assert.ok(!labels(ctx.segCats()).includes('Boxing Combos'));
});

test('a kickboxing segment keeps its own writing hint', () => {
  ctx.currentEntry = { label: 'Kickboxing', program: 'Kickboxing' };
  assert.strictEqual(ctx.getCat('thaipads').l, 'Thai Pads');
  assert.ok(/round/i.test(ctx.getCat('boxing').ph));
});

test('the open segment list is readable in dark mode', () => {
  assert.ok(/(^|\n)select option \{ background: var\(--surface\); color: var\(--text\); \}/.test(src.replace(/\r/g, '')));
});

console.log('segments: ' + passed + ' passed, ' + failed + ' failed');

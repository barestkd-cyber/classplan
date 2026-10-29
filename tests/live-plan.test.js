/* ============================================================================
 * Running a plan in class: the tap keeps the gold (Race, 2026-10-28)
 * ----------------------------------------------------------------------------
 * Plain Node, no dependencies. Run from the classplan repo root:
 *     node tests/live-plan.test.js
 *
 * Zach opened his plan during class. The gold stayed on the segment the clock
 * said was running, whatever he tapped, and a segment he opened shut itself
 * on the next 10-second tick. This runs the real live clock against a fake
 * plan: the last segment tapped holds the gold, and nothing closes unless it
 * is tapped closed.
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

// The live clock block, from its banner to the modal code after it.
const start = src.indexOf('// LIVE CLOCK');
const clockSrc = src.slice(start, src.indexOf('function closeModal()', start));

// Kickboxing at 6:30, an hour: 10, 10, 15, 15 and 10 minutes.
const ENTRY = { timeH: 18, timeM: 30, duration: 60 };
const SEGS = [10, 10, 15, 15, 10].map(mins => ({ mins }));

function classList(names) {
  const set = new Set(names.split(' ').filter(Boolean));
  return {
    add: (...c) => c.forEach(x => set.add(x)),
    remove: (...c) => c.forEach(x => set.delete(x)),
    toggle(c, force) { const on = force === undefined ? !set.has(c) : !!force; if (on) set.add(c); else set.delete(c); return on; },
    contains: c => set.has(c),
  };
}

// A plan as buildReadOnlyPlan leaves it: every segment open.
function plan(hh, mm) {
  const clock = { value: new Date(2026, 9, 28, hh, mm).getTime() };
  class ClockDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.value); }
    static now() { return clock.value; }
  }
  const segs = SEGS.map((_, i) => ({ id: 'ro-seg-' + i, dataset: { index: String(i) }, classList: classList('ro-seg open') }));
  const byId = { liveClockTime: { textContent: '' } };
  segs.forEach(s => { byId[s.id] = s; });
  const ctx = vm.createContext({
    Date: ClockDate,
    document: { getElementById: id => byId[id] || null, querySelectorAll: () => segs },
    getSegsForEntry: () => SEGS,
    setInterval: () => 1, clearInterval: () => {},
  });
  vm.runInContext('let clockInterval = null;\n' + clockSrc, ctx);
  ctx.startLiveClock(ENTRY);
  return {
    segs,
    tap: i => ctx.roSegTap(segs[i]),
    at: (h, m) => { clock.value = new Date(2026, 9, 28, h, m).getTime(); ctx.tickClock(ENTRY); },
    open: () => segs.filter(s => s.classList.contains('open')).map(s => +s.dataset.index),
    gold: () => segs.filter(s => s.classList.contains('live-active')).map(s => +s.dataset.index),
    dim: () => segs.filter(s => s.classList.contains('live-done')).map(s => +s.dataset.index),
  };
}

test('opened mid-class, the plan shows the segment running now in gold', () => {
  const p = plan(18, 45); // 15 minutes in: the second segment
  assert.deepStrictEqual(p.gold(), [1]);
  assert.deepStrictEqual(p.open(), [1]);
  assert.deepStrictEqual(p.dim(), [0]);
});

test('a tap moves the gold to that segment and opens it', () => {
  const p = plan(18, 45);
  p.tap(3);
  assert.deepStrictEqual(p.gold(), [3]);
  assert.ok(p.open().includes(3), 'the tapped segment did not open');
  assert.ok(p.open().includes(1), 'the segment that was running closed when another was tapped');
});

test('tapping ahead never fades the segment still running', () => {
  const p = plan(18, 45);
  p.tap(3);
  assert.deepStrictEqual(p.dim(), [0], 'only what the clock has finished should fade');
});

test('tapping back to a finished segment shows it in full gold', () => {
  const p = plan(19, 0); // 30 minutes in: the third segment
  p.tap(0);
  assert.deepStrictEqual(p.gold(), [0]);
  assert.deepStrictEqual(p.dim(), [1], 'the gold segment faded');
});

test('a segment opened by a tap stays open, and keeps the gold, when the clock ticks', () => {
  const p = plan(18, 45);
  p.tap(3);
  p.at(18, 45); p.at(18, 46);
  assert.deepStrictEqual(p.gold(), [3], 'the clock took the gold back');
  assert.deepStrictEqual(p.open(), [1, 3], 'the clock closed a segment');
});

test('class moving on never takes the gold off the last segment tapped', () => {
  const p = plan(18, 35);
  p.tap(2);
  p.at(18, 55); p.at(19, 10); p.at(19, 25);
  assert.deepStrictEqual(p.gold(), [2]);
  assert.deepStrictEqual(p.dim(), [0, 1, 3], 'finished segments fade, the gold one never does');
});

test('the last tap wins, even tapping a segment closed', () => {
  const p = plan(18, 45);
  p.tap(3); p.tap(1);
  assert.deepStrictEqual(p.gold(), [1]);
  assert.deepStrictEqual(p.open(), [3], 'tapping an open segment should close it');
});

test('nothing closes by itself, all class long', () => {
  const p = plan(18, 35);
  [1, 2, 3, 4].forEach(i => p.tap(i));
  for (let m = 36; m < 90; m += 3) p.at(18 + Math.floor(m / 60), m % 60);
  assert.deepStrictEqual(p.open(), [0, 1, 2, 3, 4]);
});

test('before any tap, the clock moves the gold on and opens the next segment beside the last', () => {
  const p = plan(18, 35);
  assert.deepStrictEqual(p.gold(), [0]);
  p.at(18, 41);
  assert.deepStrictEqual(p.gold(), [1]);
  assert.deepStrictEqual(p.open(), [0, 1], 'the segment before closed by itself');
});

test('outside class a tap still marks the segment, and nothing dims', () => {
  const p = plan(14, 0);
  assert.deepStrictEqual(p.open(), [0, 1, 2, 3, 4], 'the plan should open with every segment showing');
  assert.deepStrictEqual(p.gold(), []);
  p.tap(2);
  assert.deepStrictEqual(p.gold(), [2]);
  assert.deepStrictEqual(p.dim(), []);
});

test('the segment header taps through roSegTap', () => {
  assert.ok(src.includes('<div class="ro-seg-top" onclick="roSegTap(this.parentElement)">'));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');

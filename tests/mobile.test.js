/* ============================================================================
 * Coming back from another app keeps your place (Race, 2026-10-28)
 * ----------------------------------------------------------------------------
 * Plain Node, no dependencies. Run from the classplan repo root:
 *     node tests/mobile.test.js
 *
 * Zach left the plan editor to copy something, came back, and was sent to the
 * top of the page with the keyboard open over the buttons. This runs the real
 * visibilitychange handler against a fake page.
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

// The handler block, from its state object through the listener.
const start = src.indexOf('const cpReturnTo');
const end = src.indexOf('});', src.indexOf("document.addEventListener('visibilitychange'", start)) + 3;
const handlerSrc = src.slice(start, end);

function page({ touch }) {
  const listeners = {}, timers = [];
  const col = { scrollTop: 0 };
  const field = { blurred: false, blur() { this.blurred = true; } };
  const win = {
    scrollY: 0,
    scrollTo(x, y) { this.scrollY = y; },
    matchMedia: () => ({ matches: touch }),
  };
  const doc = {
    hidden: false, body: {}, activeElement: field,
    addEventListener: (t, fn) => { listeners[t] = fn; },
    querySelector: () => col,
  };
  const ctx = vm.createContext({
    document: doc, window: win,
    requestAnimationFrame: fn => timers.push(fn), setTimeout: fn => timers.push(fn),
  });
  vm.runInContext(handlerSrc, ctx);
  const flush = () => { while (timers.length) timers.shift()(); };
  return { doc, win, col, field, fire: () => listeners.visibilitychange(), flush };
}

test('leaving on a phone lets go of the field, so no keyboard pops up on return', () => {
  const p = page({ touch: true });
  p.doc.hidden = true; p.fire();
  assert.strictEqual(p.field.blurred, true);
});

test('coming back puts the plan where it was, not at the top', () => {
  const p = page({ touch: true });
  p.win.scrollY = 120; p.col.scrollTop = 900;
  p.doc.hidden = true; p.fire();
  // The phone resets both while the planner is away.
  p.win.scrollY = 0; p.col.scrollTop = 0;
  p.doc.hidden = false; p.fire(); p.flush();
  assert.strictEqual(p.col.scrollTop, 900);
  assert.strictEqual(p.win.scrollY, 120);
});

test('a computer keeps its focus when switching tabs', () => {
  const p = page({ touch: false });
  p.doc.hidden = true; p.fire();
  assert.strictEqual(p.field.blurred, false);
});

console.log('mobile: ' + passed + ' passed, ' + failed + ' failed');

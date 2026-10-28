/* ============================================================================
 * Class Plan templates - each entry point uses its own controls (audit A12)
 * ----------------------------------------------------------------------------
 * Plain Node, no dependencies. Run from the classplan repo root:
 *     node tests/templates.test.js
 *
 * Templates are managed from a modal AND from the admin panel's Templates tab.
 * Both used the ids newTemplateName and templateList. getElementById returns
 * the first match - the modal's - so "+ New" in the admin panel read an empty
 * box and refused, and the list drew into the hidden modal. This pulls the real
 * functions out of the page and runs them against a DOM holding both surfaces.
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

function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('function ' + name + ' not found in index.html');
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
  }
  throw new Error('unterminated ' + name);
}

function page() {
  const els = {};
  const mk = id => ({ id, value: '', innerHTML: '', kids: [], appendChild(c) { this.kids.push(c); } });
  ['newTemplateName', 'newTemplateName-panel', 'templateList', 'templateList-panel'].forEach(id => { els[id] = mk(id); });
  const toasts = [];
  const ctx = vm.createContext({
    document: { getElementById: id => els[id] || null, createElement: () => ({ style: {}, innerHTML: '' }) },
    templates: [], nextTemplateId: 1, currentWeekOffset: 0,
    SCHEDULE_TEMPLATE: [{ day: 0, time: '17:00', label: 'Juniors', belt: '', defaultInstructor: 'Chief', defaultInstructorId: 'u-race' }],
    planners: [{ id: 'u-race', name: 'Race Bares', kind: 'admin' }],
    getPlanData: () => ({}), templateSlotKey: (d, t) => d + '|' + t,
    progCssOf: () => '', showToast: m => toasts.push(m),
  });
  vm.runInContext(['createTemplate', 'renderTemplateList', 'escTpl', 'renderTemplateListInto',
    'slotInstructor', 'instructorOptions', 'plannerName'].map(grab).join('\n'), ctx);
  return { els, ctx, toasts };
}

test('no id is used twice anywhere on the page', () => {
  const ids = (src.match(/id="[^"]*"/g) || []);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  assert.deepStrictEqual([...new Set(dup)], [], 'duplicate ids: ' + dup.join(', '));
});

test('"+ New" in the admin panel creates the template (the case that was broken)', () => {
  const { els, ctx, toasts } = page();
  els['newTemplateName-panel'].value = 'Schedule B';
  vm.runInContext("createTemplate('newTemplateName-panel')", ctx);
  assert.strictEqual(ctx.templates.length, 1);
  assert.strictEqual(ctx.templates[0].name, 'Schedule B');
  assert.ok(!toasts.includes('Enter a template name'), 'it read the wrong, empty box');
  assert.strictEqual(els['newTemplateName-panel'].value, '', 'and clears the box it read');
});

test('a template keeps the instructor account, not a name', () => {
  const { els, ctx } = page();
  els['newTemplateName'].value = 'Regulars';
  vm.runInContext("createTemplate('newTemplateName')", ctx);
  assert.strictEqual(ctx.templates[0].assignments['0|17:00'], 'u-race');
});

test('"+ New" in the modal still works', () => {
  const { els, ctx } = page();
  els['newTemplateName'].value = 'Schedule A';
  vm.runInContext("createTemplate('newTemplateName')", ctx);
  assert.strictEqual(ctx.templates[0].name, 'Schedule A');
});

test('both surfaces show the templates, so neither goes stale', () => {
  const { els, ctx } = page();
  els['newTemplateName-panel'].value = 'Schedule B';
  vm.runInContext("createTemplate('newTemplateName-panel')", ctx);
  assert.strictEqual(els['templateList-panel'].kids.length, 1, 'the panel you are looking at');
  assert.strictEqual(els['templateList'].kids.length, 1, 'and the modal');
});

test('each "+ New" button names its own box', () => {
  assert.ok(src.includes(`onclick="createTemplate('newTemplateName')"`));
  assert.ok(src.includes(`onclick="createTemplate('newTemplateName-panel')"`));
});

test('a template name with markup renders as text', () => {
  const { els, ctx } = page();
  els['newTemplateName'].value = '<img src=x onerror=alert(1)>';
  vm.runInContext("createTemplate('newTemplateName')", ctx);
  const html = els['templateList'].kids.map(k => k.innerHTML).join('');
  assert.ok(html.includes('&lt;img'), 'escaped');
  assert.ok(!html.includes('<img src=x'), 'not live markup');
});

console.log('templates: ' + passed + ' passed, ' + failed + ' failed');

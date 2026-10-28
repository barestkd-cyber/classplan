/* ============================================================================
 * Classes belong to accounts, not names (Race, 2026-10-28)
 * ----------------------------------------------------------------------------
 * Plain Node, no dependencies. Run from the classplan repo root:
 *     node tests/accounts.test.js
 *
 * An instructor could edit any class whose assigned name matched the first
 * name on their login, and the instructor list was an in-memory roster that
 * reset to "Chief" on every load. Now a class carries the account id that
 * teaches it (a week's own assignment, else the class's regular instructor),
 * and only that account may plan it. The database enforces the same rule
 * (sql/class-planners.sql); these pull the real functions out of the page.
 * ========================================================================== */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ok   ' + name); passed++; }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + (e && e.message)); failed++; process.exitCode = 1; }
}

function grab(name) {
  let i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('function ' + name + ' not found in index.html');
  if (src.slice(i - 6, i) === 'async ') i -= 6; // keep async, or await will not parse
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
  }
  throw new Error('unterminated ' + name);
}

const ZACH = 'u-zach', ZACH_TWO = 'u-zach-2', DUSTIN = 'u-dustin';
const KICKBOXING = { day: 0, time: '5:45', label: 'Kickboxing', defaultInstructor: 'Zach Lackey', defaultInstructorId: ZACH };

function page(extra) {
  const upserts = [], toasts = [];
  const ctx = vm.createContext(Object.assign({
    viewAs: null, isAdmin: false, myAccount: { id: ZACH, name: 'Zach Lackey' },
    currentRole: 'student', isPlannerAccount: false, accountIsAdmin: false,
    planData: {}, currentEntry: null, SCHEDULE_TEMPLATE: [KICKBOXING],
    getWeekStart: () => new Date(2026, 10, 2),
    showToast: m => toasts.push(m), console: { error() {} },
    sb: { from: () => ({ upsert: async row => { upserts.push(row); return { error: null }; } }) },
  }, extra || {}));
  vm.runInContext(['actingId', 'actingName', 'isMine', 'slotInstructor', 'claimInheritedWeek',
    'cpIsStaff', 'saveSlot', 'parseSlotKey', 'localYMD'].map(grab).join('\n'), ctx);
  return { ctx, upserts, toasts };
}

(async () => {
  await test("a week with no assignment of its own follows the class's regular instructor", () => {
    const { ctx } = page();
    const who = ctx.slotInstructor({ status: 'none', instructor: '', planId: null }, KICKBOXING);
    assert.deepStrictEqual({ ...who }, { id: ZACH, name: 'Zach Lackey' });
  });

  await test("a week's own assignment wins over the regular instructor", () => {
    const { ctx } = page();
    const who = ctx.slotInstructor({ instructor: 'Dustin Wilson', instructorId: DUSTIN }, KICKBOXING);
    assert.strictEqual(who.id, DUSTIN);
  });

  await test('owning a class is the account id, so a matching name owns nothing', () => {
    const { ctx } = page({ myAccount: { id: ZACH_TWO, name: 'Zach Lackey' } });
    assert.strictEqual(ctx.isMine({ instructor: 'Zach Lackey', instructorId: ZACH }), false,
      'a second account named Zach must not plan the first Zach\'s class');
    assert.strictEqual(ctx.isMine({ instructor: 'Zach Lackey', instructorId: ZACH_TWO }), true);
  });

  await test('a class with a name but no account belongs to nobody', () => {
    const { ctx } = page();
    assert.strictEqual(ctx.isMine({ instructor: 'Zach Lackey', instructorId: null }), false);
  });

  await test("an admin previewing an instructor sees that instructor's classes as theirs", () => {
    const { ctx } = page({ myAccount: { id: 'u-race', name: 'Race Bares' }, viewAs: { id: DUSTIN, name: 'Dustin Wilson' } });
    assert.strictEqual(ctx.isMine({ instructorId: DUSTIN }), true);
    assert.strictEqual(ctx.actingName(), 'Dustin Wilson');
  });

  await test('saving a plan on a followed week writes the instructor account onto it', () => {
    const { ctx } = page({ currentEntry: { instructor: 'Zach Lackey', instructorId: ZACH } });
    const pd = { status: 'none', instructor: '', planId: null };
    ctx.claimInheritedWeek(pd);
    assert.strictEqual(pd.instructorId, ZACH);
    assert.strictEqual(pd.instructor, 'Zach Lackey');
  });

  await test("a week assigned to someone else is never claimed by a save", () => {
    const { ctx } = page({ currentEntry: { instructor: 'Zach Lackey', instructorId: ZACH } });
    const pd = { status: 'none', instructor: 'Dustin Wilson', instructorId: DUSTIN, planId: null };
    ctx.claimInheritedWeek(pd);
    assert.strictEqual(pd.instructorId, DUSTIN);
  });

  await test('the saved row carries instructor_id for the database to check', async () => {
    const { ctx, upserts } = page();
    ctx.planData['0-0-5:45'] = { status: 'draft', instructor: 'Zach Lackey', instructorId: ZACH, planId: '0-0-5:45' };
    await ctx.saveSlot('0-0-5:45');
    assert.strictEqual(upserts.length, 1);
    assert.strictEqual(upserts[0].instructor_id, ZACH);
    assert.strictEqual(upserts[0].week_start, '2026-11-02');
  });

  await test('a refused save says so instead of failing silently', async () => {
    const { ctx, toasts } = page({
      sb: { from: () => ({ upsert: async () => ({ error: { code: '42501', message: 'new row violates row-level security policy' } }) }) },
    });
    ctx.planData['0-0-5:45'] = { status: 'draft', instructor: 'Zach Lackey', instructorId: ZACH };
    await ctx.saveSlot('0-0-5:45');
    assert.ok(toasts.some(t => /not assigned to you/.test(t)), toasts.join(' | '));
  });

  await test('a class planner account gets in; a student does not', () => {
    assert.strictEqual(page({ isPlannerAccount: true }).ctx.cpIsStaff(), true);
    assert.strictEqual(page().ctx.cpIsStaff(), false);
    assert.strictEqual(page({ currentRole: 'admin' }).ctx.cpIsStaff(), true);
  });

  await test('admin comes from the account: the old PIN is gone', () => {
    assert.ok(!/pin\s*!==\s*'1234'/.test(src), 'a typed PIN must not make anyone an admin');
    assert.ok(/isAdmin = accountIsAdmin/.test(src));
  });

  await test('no ownership check compares the name on the header chip', () => {
    assert.ok(!src.includes("=== document.getElementById('userChip').textContent"));
  });

  console.log('accounts: ' + passed + ' passed, ' + failed + ' failed');
})();

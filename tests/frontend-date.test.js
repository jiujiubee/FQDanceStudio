'use strict';
/** 前端日期/日历工具测试：通过 TypeScript 即时转译加载 miniprogram/utils/date.ts */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadTs(rel) {
  const file = path.join(__dirname, '..', rel);
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out.outputText)(m, m.exports, require);
  return m.exports;
}

const d = loadTs('miniprogram/utils/date.ts');

test('Shanghai date boundary: 16:30 UTC is next day in Shanghai', () => {
  assert.strictEqual(d.toDate(Date.UTC(2024, 5, 2, 16, 30)), '2024-06-03');
  assert.strictEqual(d.toTime(Date.UTC(2024, 5, 2, 16, 30)), '00:30');
});

test('weekStart returns Monday; Sunday belongs to previous week', () => {
  assert.strictEqual(d.weekStart('2024-06-05'), '2024-06-03');
  assert.strictEqual(d.weekStart('2024-06-09'), '2024-06-03');
  assert.strictEqual(d.weekStart('2024-06-10'), '2024-06-10');
});

test('buildWeek produces Monday-Sunday with marks and flags', () => {
  const w = d.buildWeek('2024-06-03', '2024-06-05', '2024-06-06', { '2024-06-06': 2 });
  assert.strictEqual(w.length, 7);
  assert.deepStrictEqual(w.map((x) => x.weekday), ['一', '二', '三', '四', '五', '六', '日']);
  assert.ok(w[2].isToday);
  assert.ok(w[0].isPast && !w[2].isPast);
  assert.ok(w[3].isSelected);
  assert.strictEqual(w[3].count, 2);
});

test('shiftWeek blocks navigation before current week', () => {
  assert.strictEqual(d.shiftWeek('2024-06-03', -1, '2024-06-05'), null);
  assert.strictEqual(d.shiftWeek('2024-06-03', 1, '2024-06-05'), '2024-06-10');
  assert.strictEqual(d.shiftWeek('2024-06-10', -1, '2024-06-05'), '2024-06-03');
});

test('defaultSelected picks today for current week, Monday otherwise', () => {
  assert.strictEqual(d.defaultSelected('2024-06-03', '2024-06-05'), '2024-06-05');
  assert.strictEqual(d.defaultSelected('2024-06-10', '2024-06-05'), '2024-06-10');
});

test('weekTitle handles month and year crossings', () => {
  assert.strictEqual(d.weekTitle('2024-06-03'), '2024年6月');
  assert.strictEqual(d.weekTitle('2024-07-29'), '2024年7月 - 8月');
  assert.strictEqual(d.weekTitle('2024-12-30'), '2024年12月 - 2025年1月');
});

test('buildMonth is a 6x7 Monday-first grid with disabled past days', () => {
  const cells = d.buildMonth('2024-02', '2024-02-10', ['2024-02-14'], { '2024-02-14': 1 }, '2024-02-10');
  assert.strictEqual(cells.length, 42);
  assert.strictEqual(cells[0].date, '2024-01-29');
  assert.strictEqual(cells.filter((c) => c.inMonth).length, 29);
  const c14 = cells.find((c) => c.date === '2024-02-14');
  assert.ok(c14.isSelected && c14.count === 1 && !c14.disabled);
  assert.ok(cells.find((c) => c.date === '2024-02-09').disabled);
});

test('addMonths and daysInMonth', () => {
  assert.strictEqual(d.addMonths('2024-12', 1), '2025-01');
  assert.strictEqual(d.addMonths('2024-01', -1), '2023-12');
  assert.strictEqual(d.daysInMonth('2024-02'), 29);
  assert.strictEqual(d.daysInMonth('2023-02'), 28);
});

test('Chinese formatting', () => {
  assert.strictEqual(d.dateCN('2024-06-03'), '6月3日 周一');
  assert.strictEqual(d.durationCN(90), '1小时30分钟');
  assert.strictEqual(d.durationCN(45), '45分钟');
  assert.strictEqual(d.durationCN(120), '2小时');
});

test('every page in app.json has all four files', () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'app.json'), 'utf8'));
  const comps = Object.values(app.usingComponents).map((p) => p.slice(1));
  for (const p of [...app.pages, ...comps]) {
    for (const ext of ['.ts', '.wxml', '.json']) {
      const f = path.join(__dirname, '..', 'miniprogram', p + ext);
      assert.ok(fs.existsSync(f) && fs.statSync(f).size > 0, `missing or empty: ${p}${ext}`);
    }
  }
});

test('no emoji characters in UI templates', () => {
  const root = path.join(__dirname, '..', 'miniprogram');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  for (const f of walk(root).filter((x) => /\.(wxml|ts|json)$/.test(x))) {
    assert.ok(!re.test(fs.readFileSync(f, 'utf8')), `emoji found in ${f}`);
  }
});

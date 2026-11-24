import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays,
  diffDays,
  formatJpDate,
  formatJpDateTime,
  isFriday,
  isValidDate,
  nextFriday,
  nowJstIso,
  todayJst,
  upcomingFridays,
  weekdayJa,
} from '../site/js/core/dates.js';

const at = (iso) => new Date(iso);

test('isValidDate: 実在する日付だけを受理する', () => {
  assert.equal(isValidDate('2026-11-27'), true);
  assert.equal(isValidDate('2024-02-29'), true);
  assert.equal(isValidDate('2026-02-29'), false, 'うるう年ではない年');
  assert.equal(isValidDate('2026-02-30'), false);
  assert.equal(isValidDate('2026-13-01'), false);
  assert.equal(isValidDate('2026-11-2'), false, '2桁でない');
  assert.equal(isValidDate('2026/11/27'), false);
  assert.equal(isValidDate(20261127), false);
  assert.equal(isValidDate(null), false);
  assert.equal(isValidDate(''), false);
});

test('todayJst: 日本時間で日付を判定する（UTC の日付とは異なる場合を含む）', () => {
  assert.equal(todayJst(at('2026-11-24T09:42:48Z')), '2026-11-24', 'JST 2026-11-24 18:42');
  assert.equal(todayJst(at('2026-11-24T15:30:00Z')), '2026-11-25', 'JST 2026-11-25 00:30（UTC はまだ24日）');
  assert.equal(todayJst(at('2026-11-24T14:59:59Z')), '2026-11-24', 'JST 2026-11-24 23:59:59');
  assert.equal(todayJst(at('2026-01-01T00:30:00Z')), '2026-01-01', 'JST 2026-01-01 09:30');
});

test('todayJst: 無効な Date は投げる', () => {
  assert.throws(() => todayJst(new Date('invalid')), TypeError);
  assert.throws(() => todayJst('2026-11-24'), TypeError);
});

test('nowJstIso: JST のタイムゾーン付き ISO 8601 になる', () => {
  assert.equal(nowJstIso(at('2026-11-24T10:10:05Z')), '2026-11-24T19:10:05+09:00');
  assert.equal(nowJstIso(at('2026-11-24T15:00:00Z')), '2026-11-25T00:00:00+09:00', 'JST の0時は 00 になる');
});

test('addDays: 月またぎ・年またぎ・うるう年', () => {
  assert.equal(addDays('2026-11-27', 1), '2026-11-28');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-11-27', -3), '2026-11-24');
  assert.throws(() => addDays('2026-02-30', 1), TypeError);
});

test('diffDays', () => {
  assert.equal(diffDays('2026-11-27', '2026-11-28'), 1);
  assert.equal(diffDays('2026-11-27', '2026-11-27'), 0);
  assert.equal(diffDays('2026-11-28', '2026-11-27'), -1);
  assert.equal(diffDays('2026-11-27', '2027-11-27'), 365);
});

test('weekdayJa / isFriday', () => {
  assert.equal(weekdayJa('2026-11-27'), '金');
  assert.equal(weekdayJa('2026-11-24'), '火');
  assert.equal(weekdayJa('2026-11-22'), '日');
  assert.equal(isFriday('2026-11-27'), true);
  assert.equal(isFriday('2026-11-28'), false);
});

test('nextFriday: 火曜日からは3日後の金曜', () => {
  assert.equal(nextFriday('2026-11-24'), '2026-11-27');
});

test('nextFriday: 金曜日当日は inclusive により当日または翌週', () => {
  assert.equal(nextFriday('2026-11-27'), '2026-11-27');
  assert.equal(nextFriday('2026-11-27', { inclusive: false }), '2026-12-04');
});

test('nextFriday: 週のそれぞれの日から直近の金曜', () => {
  assert.equal(nextFriday('2026-11-28'), '2026-12-04', '土');
  assert.equal(nextFriday('2026-11-29'), '2026-12-04', '日');
  assert.equal(nextFriday('2026-11-30'), '2026-12-04', '月');
  assert.equal(nextFriday('2026-12-01'), '2026-12-04', '火');
  assert.equal(nextFriday('2026-12-02'), '2026-12-04', '水');
  assert.equal(nextFriday('2026-12-03'), '2026-12-04', '木');
});

test('upcomingFridays: 直近から7日おき', () => {
  assert.deepEqual(upcomingFridays('2026-11-24', 4), ['2026-11-27', '2026-12-04', '2026-12-11', '2026-12-18']);
  assert.deepEqual(upcomingFridays('2026-11-27', 2), ['2026-11-27', '2026-12-04']);
  assert.deepEqual(upcomingFridays('2026-12-25', 3), ['2026-12-25', '2027-01-01', '2027-01-08'], '年またぎ');
  assert.deepEqual(upcomingFridays('2026-11-24', 0), []);
});

test('formatJpDate', () => {
  assert.equal(formatJpDate('2026-11-27'), '11月27日（金）');
  assert.equal(formatJpDate('2026-01-05'), '1月5日（月）');
  assert.equal(formatJpDate('2026-13-01'), '');
  assert.equal(formatJpDate(undefined), '');
});

test('formatJpDateTime: JST 表記にそろえる', () => {
  assert.equal(formatJpDateTime('2026-11-24T19:10:00+09:00'), '2026/11/24 19:10');
  assert.equal(formatJpDateTime('2026-11-24T10:10:00Z'), '2026/11/24 19:10', 'UTC 表記でも JST に変換');
  assert.equal(formatJpDateTime('2026-11-24T16:30:00Z'), '2026/11/25 01:30', 'JST では翌日');
  assert.equal(formatJpDateTime('2026-11-24'), '2026/11/24 09:00', '日付のみの文字列は UTC 0 時として解釈される');
  assert.equal(formatJpDateTime('not-a-date'), '');
  assert.equal(formatJpDateTime(undefined), '');
});

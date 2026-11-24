import test from 'node:test';
import assert from 'node:assert/strict';

import { AREA_IDS, areaLabel } from '../site/js/core/areas.js';
import { DEFAULT_BUDGET, MAX_ADULTS, NIGHTS, ROOMS, defaultConditions, normalizeConditions } from '../site/js/core/conditions.js';

/** チェックイン日・チェックアウト日以外は常にこの値（人数・部屋数・泊数・予算は固定） */
const FIXED = { nights: 1, adults: 4, rooms: 1, budget: 10000 };

test('エリア定義: 関東1都6県と静岡東部', () => {
  assert.deepEqual([...AREA_IDS], ['tokyo', 'kanagawa', 'chiba', 'saitama', 'ibaraki', 'tochigi', 'gunma', 'shizuoka-east']);
  assert.equal(areaLabel('shizuoka-east'), '静岡東部');
  assert.equal(areaLabel('okinawa'), '');
});

test('固定の条件は 大人4名・1部屋・1泊・1部屋総額10,000円', () => {
  assert.equal(MAX_ADULTS, 4);
  assert.equal(ROOMS, 1);
  assert.equal(NIGHTS, 1);
  assert.equal(DEFAULT_BUDGET, 10000);
});

test('defaultConditions: 直近の金曜・1泊・大人4名・1部屋・10,000円・全エリア', () => {
  assert.deepEqual(defaultConditions({ today: '2026-11-24' }), {
    checkin: '2026-11-27',
    checkout: '2026-11-28',
    ...FIXED,
    areaIds: [...AREA_IDS],
  });
  assert.equal(defaultConditions({ today: '2026-11-27' }).checkin, '2026-11-27', '金曜日のときは当日');
  assert.equal(defaultConditions({ today: '2026-11-28' }).checkin, '2026-12-04', '土曜日のときは翌週の金曜');
});

test('normalizeConditions: 未指定の項目は初期値になり、チェックアウトは翌日になる', () => {
  const result = normalizeConditions({ checkin: '2026-11-27' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.value, { checkin: '2026-11-27', checkout: '2026-11-28', ...FIXED, areaIds: [...AREA_IDS] });
});

test('normalizeConditions: 人数・部屋数・泊数・予算は固定。入力に含まれていても読まず、常に固定の値（数値）を返す', () => {
  const extras = [
    { adults: 2, rooms: 2, nights: 3, budget: 999999 },
    { adults: '2', budget: 'none' },
    { adults: '4', budget: '10000' },
    { adults: 9, budget: -5 },
  ];
  for (const extra of extras) {
    const result = normalizeConditions({ checkin: '2026-11-27', ...extra });
    assert.equal(result.ok, true, JSON.stringify(extra));
    assert.deepEqual(result.errors, [], JSON.stringify(extra));
    assert.deepEqual(result.value, { checkin: '2026-11-27', checkout: '2026-11-28', ...FIXED, areaIds: [...AREA_IDS] }, JSON.stringify(extra));
  }
});

test('normalizeConditions: 別の日付を指定するとチェックアウトはその翌日', () => {
  const result = normalizeConditions({ checkin: '2026-12-31' });
  assert.equal(result.value.checkin, '2026-12-31');
  assert.equal(result.value.checkout, '2027-01-01');
});

test('normalizeConditions: 日付の前後の空白を除き、エリアは定義順に並ぶ', () => {
  const result = normalizeConditions({ checkin: ' 2026-11-27 ', areaIds: ['kanagawa', 'tokyo'] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { checkin: '2026-11-27', checkout: '2026-11-28', ...FIXED, areaIds: ['tokyo', 'kanagawa'] });
});

test('normalizeConditions: エリアはカンマ区切りの文字列でも指定できる', () => {
  const result = normalizeConditions({ checkin: '2026-11-27', areaIds: 'kanagawa, chiba' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.areaIds, ['kanagawa', 'chiba']);
});

test('normalizeConditions: おかしい入力は ok=false になり、日本語の理由を返す', () => {
  const errorsOf = (input) => {
    const result = normalizeConditions(input);
    assert.equal(result.ok, false, JSON.stringify(input) ?? String(input));
    return result.errors;
  };
  assert.equal(errorsOf({}).length, 1);
  assert.equal(errorsOf(undefined).length, 1);
  assert.equal(errorsOf([]).length, 1);
  assert.match(errorsOf({ checkin: '2026-13-01' })[0], /チェックイン日/);
  assert.match(errorsOf({ checkin: '2026-02-30' })[0], /チェックイン日/);
  assert.match(errorsOf({ checkin: '' })[0], /チェックイン日/);
  assert.match(errorsOf({ checkin: '2026-11-27', areaIds: ['moon'] })[0], /エリア/);
  assert.match(errorsOf({ checkin: '2026-11-27', areaIds: ['tokyo', 'moon'] })[0], /エリア/);
  assert.equal(errorsOf({ checkin: '2026-11-27', areaIds: [] })[0], 'エリアを1つ以上選んでください');
  assert.equal(errorsOf({ checkin: 'nope', adults: 9, budget: -5, areaIds: [] }).length, 2, '問題として数えるのは日付とエリアだけ（人数・予算は固定）');
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { AREA_IDS, areaLabel } from '../site/js/core/areas.js';
import { DEFAULT_BUDGET, MAX_ADULTS, defaultConditions, normalizeConditions } from '../site/js/core/conditions.js';

const BASE = { checkin: '2026-11-27', checkout: '2026-11-28', nights: 1, rooms: 1 };

test('エリア定義: 関東1都6県と静岡東部', () => {
  assert.deepEqual([...AREA_IDS], ['tokyo', 'kanagawa', 'chiba', 'saitama', 'ibaraki', 'tochigi', 'gunma', 'shizuoka-east']);
  assert.equal(areaLabel('shizuoka-east'), '静岡東部');
  assert.equal(areaLabel('okinawa'), '');
});

test('defaultConditions: 直近の金曜・1泊・大人4名・1部屋・10,000円・全エリア', () => {
  assert.equal(MAX_ADULTS, 4);
  assert.equal(DEFAULT_BUDGET, 10000);
  assert.deepEqual(defaultConditions({ today: '2026-11-24' }), {
    checkin: '2026-11-27',
    checkout: '2026-11-28',
    nights: 1,
    adults: 4,
    rooms: 1,
    budget: 10000,
    areaIds: [...AREA_IDS],
  });
  assert.equal(defaultConditions({ today: '2026-11-27' }).checkin, '2026-11-27', '金曜日のときは当日');
  assert.equal(defaultConditions({ today: '2026-11-28' }).checkin, '2026-12-04', '土曜日のときは翌週の金曜');
});

test('normalizeConditions: 未指定の項目は初期値になり、チェックアウトは翌日になる', () => {
  const result = normalizeConditions({ checkin: '2026-11-27' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.value, { ...BASE, adults: 4, budget: 10000, areaIds: [...AREA_IDS] });
});

test('normalizeConditions: フォームやURL由来の文字列を数値に整える', () => {
  const result = normalizeConditions({ checkin: ' 2026-11-27 ', adults: '2', budget: '8000', areaIds: ['kanagawa', 'tokyo'] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { ...BASE, adults: 2, budget: 8000, areaIds: ['tokyo', 'kanagawa'] }, 'エリアは定義順に並ぶ');
});

test('normalizeConditions: 別の日付を指定するとチェックアウトはその翌日', () => {
  const result = normalizeConditions({ checkin: '2026-12-31', adults: '3' });
  assert.equal(result.value.checkout, '2027-01-01');
  assert.equal(result.value.adults, 3);
});

test('normalizeConditions: 予算の「上限なし」', () => {
  assert.equal(normalizeConditions({ checkin: '2026-11-27', budget: null }).value.budget, null);
  assert.equal(normalizeConditions({ checkin: '2026-11-27', budget: '' }).value.budget, null);
  assert.equal(normalizeConditions({ checkin: '2026-11-27', budget: 'none' }).value.budget, null);
  assert.equal(normalizeConditions({ checkin: '2026-11-27', budget: 'NONE' }).value.budget, null);
  assert.equal(normalizeConditions({ checkin: '2026-11-27', budget: 0 }).value.budget, 0);
  assert.equal(normalizeConditions({ checkin: '2026-11-27', budget: ' 15000 ' }).value.budget, 15000);
});

test('normalizeConditions: 大人は1〜4名', () => {
  for (const adults of [1, 2, 3, 4]) {
    assert.equal(normalizeConditions({ checkin: '2026-11-27', adults }).ok, true, `大人${adults}名`);
  }
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
  assert.match(errorsOf({ checkin: '2026-11-27', adults: 5 })[0], /大人/);
  assert.match(errorsOf({ checkin: '2026-11-27', adults: 0 })[0], /大人/);
  assert.match(errorsOf({ checkin: '2026-11-27', adults: '2.5' })[0], /大人/);
  assert.match(errorsOf({ checkin: '2026-11-27', adults: 'abc' })[0], /大人/);
  assert.match(errorsOf({ checkin: '2026-11-27', budget: -1 })[0], /予算/);
  assert.match(errorsOf({ checkin: '2026-11-27', budget: '10000.5' })[0], /予算/);
  assert.match(errorsOf({ checkin: '2026-11-27', budget: 'abc' })[0], /予算/);
  assert.match(errorsOf({ checkin: '2026-11-27', areaIds: ['moon'] })[0], /エリア/);
  assert.match(errorsOf({ checkin: '2026-11-27', areaIds: ['tokyo', 'moon'] })[0], /エリア/);
  assert.equal(errorsOf({ checkin: '2026-11-27', areaIds: [] })[0], 'エリアを1つ以上選んでください');
  assert.equal(errorsOf({ checkin: 'nope', adults: 9, budget: -5, areaIds: [] }).length, 4, '複数の問題をまとめて返す');
});

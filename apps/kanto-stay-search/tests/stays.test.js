import test from 'node:test';
import assert from 'node:assert/strict';

import { AREA_IDS } from '../site/js/core/areas.js';
import { defaultConditions } from '../site/js/core/conditions.js';
import {
  PRICE_BASIS,
  STALE_HOURS,
  freshness,
  matchesConditions,
  selectStays,
  validateDataset,
  validateEntry,
} from '../site/js/core/stays.js';

const NOW = new Date('2026-11-24T10:00:00Z'); // 2026-11-24 19:00 JST
const TODAY = '2026-11-24';

function makeEntry(overrides = {}) {
  return {
    id: 'a-1',
    hotelName: '熱海温泉 サンプル旅館',
    areaId: 'shizuoka-east',
    location: '静岡県熱海市',
    roomType: '和室10畳',
    planName: '素泊まりプラン',
    priceTotal: 9800,
    priceBasis: PRICE_BASIS,
    meal: { code: 'none', label: '素泊まり（食事なし）' },
    cancellation: { text: '7日前まで無料' },
    conditions: { checkin: '2026-11-27', checkout: '2026-11-28', adults: 4, rooms: 1 },
    sourceLabel: '楽天トラベル',
    planUrl: 'https://travel.rakuten.co.jp/HOTEL/0000/0000.html',
    checkedAt: '2026-11-24T18:30:00+09:00',
    evidence: '「1室1泊 9,800円（税込）」と表示されていた',
    ...overrides,
  };
}

const COND = defaultConditions({ today: TODAY });

test('準備: 既定の条件は 2026-11-27 金曜・1泊・大人4名・1部屋・15,000円・全エリア', () => {
  assert.deepEqual(COND, {
    checkin: '2026-11-27',
    checkout: '2026-11-28',
    nights: 1,
    adults: 4,
    rooms: 1,
    budget: 15000,
    areaIds: [...AREA_IDS],
  });
});

test('validateEntry: 正しいデータは問題なし', () => {
  assert.deepEqual(validateEntry(makeEntry(), { now: NOW }), []);
});

test('validateEntry: 1人あたり料金のデータは登録できない', () => {
  const errors = validateEntry(makeEntry({ priceBasis: 'perPerson' }), { now: NOW });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /priceBasis/);
});

test('validateEntry: 必須項目が足りない・形式がおかしい場合は弾く', () => {
  assert.match(validateEntry(makeEntry({ checkedAt: undefined }), { now: NOW }).join('|'), /checkedAt/);
  assert.match(validateEntry(makeEntry({ checkedAt: '2026-11-24T18:30:00' }), { now: NOW }).join('|'), /checkedAt/, 'タイムゾーンなし');
  assert.match(validateEntry(makeEntry({ planUrl: 'http://example.com/plan' }), { now: NOW }).join('|'), /planUrl/);
  assert.match(validateEntry(makeEntry({ priceTotal: '9800' }), { now: NOW }).join('|'), /priceTotal/, '文字列の金額');
  assert.match(validateEntry(makeEntry({ priceTotal: -1 }), { now: NOW }).join('|'), /priceTotal/);
  assert.match(validateEntry(makeEntry({ areaId: 'okinawa' }), { now: NOW }).join('|'), /areaId/);
  assert.match(validateEntry(makeEntry({ evidence: '  ' }), { now: NOW }).join('|'), /evidence/);
  assert.match(validateEntry(makeEntry({ meal: { code: 'lunch', label: '昼食付き' } }), { now: NOW }).join('|'), /meal/);
  assert.match(validateEntry(makeEntry({ cancellation: {} }), { now: NOW }).join('|'), /cancellation/);
  assert.deepEqual(validateEntry(null), ['1件分のデータはオブジェクトである必要があります']);
  assert.deepEqual(validateEntry([makeEntry()]), ['1件分のデータはオブジェクトである必要があります']);
});

test('validateEntry: 確認時の条件は1泊・1〜4名・1部屋', () => {
  assert.match(
    validateEntry(makeEntry({ conditions: { checkin: '2026-11-27', checkout: '2026-11-29', adults: 4, rooms: 1 } }), { now: NOW }).join('|'),
    /checkout/,
    '2泊は登録できない',
  );
  assert.match(
    validateEntry(makeEntry({ conditions: { checkin: '2026-11-27', checkout: '2026-11-28', adults: 5, rooms: 1 } }), { now: NOW }).join('|'),
    /adults/,
  );
  assert.match(
    validateEntry(makeEntry({ conditions: { checkin: '2026-11-27', checkout: '2026-11-28', adults: 4, rooms: 2 } }), { now: NOW }).join('|'),
    /rooms/,
  );
});

test('validateEntry: 未来の時刻に確認したことになっているデータは弾く（10分以内の時差は許容）', () => {
  assert.match(validateEntry(makeEntry({ checkedAt: '2026-11-25T12:00:00+09:00' }), { now: NOW }).join('|'), /未来/);
  assert.deepEqual(validateEntry(makeEntry({ checkedAt: '2026-11-24T19:05:00+09:00' }), { now: NOW }), []);
});

test('validateDataset: 問題のある件だけを外し、残りを表示対象にする', () => {
  const result = validateDataset(
    {
      schemaVersion: 1,
      priceBasis: PRICE_BASIS,
      entries: [makeEntry(), makeEntry({ id: 'bad-1', priceBasis: 'perPerson' }), makeEntry({ id: 'b-2', priceTotal: 7000 })],
    },
    { now: NOW },
  );
  assert.equal(result.ok, false);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries.map((e) => e.id), ['a-1', 'b-2']);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /^bad-1: /);
});

test('validateDataset: id の重複は弾く', () => {
  const result = validateDataset({ schemaVersion: 1, entries: [makeEntry(), makeEntry({ hotelName: '別の宿' })] }, { now: NOW });
  assert.equal(result.entries.length, 1);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /重複/);
});

test('validateDataset: ファイル自体の形式がおかしい場合は ok=false', () => {
  assert.equal(validateDataset(null).ok, false);
  assert.equal(validateDataset({ schemaVersion: 1 }).ok, false);
  const wrongVersion = validateDataset({ schemaVersion: 2, entries: [] }, { now: NOW });
  assert.equal(wrongVersion.ok, false);
  assert.equal(wrongVersion.problems.length, 1);
  assert.deepEqual(validateDataset({ schemaVersion: 1, entries: [] }, { now: NOW }), { ok: true, problems: [], entries: [] });
});

test('matchesConditions: 日付・人数・部屋数が完全に一致した場合だけ true', () => {
  const entry = makeEntry();
  assert.equal(matchesConditions(entry, COND), true);
  assert.equal(matchesConditions(entry, { ...COND, checkin: '2026-12-04', checkout: '2026-12-05' }), false);
  assert.equal(matchesConditions(entry, { ...COND, adults: 2 }), false);
  assert.equal(matchesConditions(entry, { ...COND, adults: 3 }), false, '3名で確認したことにすり替えない');
  assert.equal(matchesConditions(entry, { ...COND, rooms: 2 }), false);
});

test('selectStays: 条件に合うものだけを安い順に返す', () => {
  const entries = [
    makeEntry({ id: 'a', priceTotal: 9800 }),
    makeEntry({ id: 'b', priceTotal: 18000 }),
    makeEntry({ id: 'c', priceTotal: 5500, conditions: { checkin: '2026-11-27', checkout: '2026-11-28', adults: 2, rooms: 1 } }),
    makeEntry({ id: 'd', priceTotal: 6000, conditions: { checkin: '2026-12-04', checkout: '2026-12-05', adults: 4, rooms: 1 } }),
    makeEntry({ id: 'e', priceTotal: 7000, areaId: 'tokyo', location: '東京都台東区' }),
    makeEntry({ id: 'f', priceTotal: 15000 }),
  ];
  assert.deepEqual(selectStays(entries, COND, { today: TODAY }).map((e) => e.id), ['e', 'a', 'f'], '11/27・4名・全エリア・15,000円以内・安い順');
  assert.deepEqual(selectStays(entries, { ...COND, budget: null }, { today: TODAY }).map((e) => e.id), ['e', 'a', 'f', 'b'], '上限なし');
  assert.deepEqual(selectStays(entries, { ...COND, budget: 20000 }, { today: TODAY }).map((e) => e.id), ['e', 'a', 'f', 'b']);
  assert.deepEqual(selectStays(entries, { ...COND, budget: 15000 }, { today: TODAY }).map((e) => e.id), ['e', 'a', 'f'], '予算と同額は含める');
  assert.deepEqual(selectStays(entries, { ...COND, budget: 7000 }, { today: TODAY }).map((e) => e.id), ['e'], '上限が下がれば外れる');
  assert.deepEqual(selectStays(entries, { ...COND, areaIds: ['tokyo'] }, { today: TODAY }).map((e) => e.id), ['e']);
  assert.deepEqual(selectStays(entries, { ...COND, adults: 2 }, { today: TODAY }).map((e) => e.id), ['c']);
  assert.deepEqual(
    selectStays(entries, { ...COND, checkin: '2026-12-04', checkout: '2026-12-05' }, { today: TODAY }).map((e) => e.id),
    ['d'],
  );
  assert.deepEqual(selectStays([], COND, { today: TODAY }), []);
});

test('selectStays: 同額なら確認が新しい方を先にする', () => {
  const entries = [
    makeEntry({ id: 'x', priceTotal: 8000, checkedAt: '2026-11-24T08:00:00+09:00' }),
    makeEntry({ id: 'y', priceTotal: 8000, checkedAt: '2026-11-24T12:00:00+09:00' }),
    makeEntry({ id: 'z', priceTotal: 7000 }),
  ];
  assert.deepEqual(selectStays(entries, COND, { today: TODAY }).map((e) => e.id), ['z', 'y', 'x']);
});

test('selectStays: チェックイン日を過ぎたものは表示しない', () => {
  const past = makeEntry({ id: 'p', priceTotal: 3000, conditions: { checkin: '2026-11-20', checkout: '2026-11-21', adults: 4, rooms: 1 } });
  const cond = { ...COND, checkin: '2026-11-20', checkout: '2026-11-21' };
  assert.deepEqual(selectStays([past], cond, { today: TODAY }), []);
  assert.deepEqual(selectStays([past], cond, { today: '2026-11-19' }).map((e) => e.id), ['p']);
  assert.deepEqual(selectStays([past], cond, { today: '2026-11-20' }).map((e) => e.id), ['p'], 'チェックイン当日はまだ表示する');
});

test('selectStays: today がない・正しくない場合は投げる', () => {
  assert.throws(() => selectStays([], COND, {}), TypeError);
  assert.throws(() => selectStays([], COND, { today: '2026-13-01' }), TypeError);
});

test('freshness: 確認から24時間で「要再確認」になる', () => {
  const entry = makeEntry(); // 2026-11-24 18:30 JST に確認
  const fresh = freshness(entry, new Date('2026-11-24T10:00:00Z'));
  assert.equal(fresh.stale, false);
  assert.equal(Number((fresh.hoursAgo).toFixed(1)), 0.5);
  assert.equal(freshness(entry, new Date('2026-11-25T09:29:00Z')).stale, false, '23時間59分');
  assert.equal(freshness(entry, new Date('2026-11-25T09:30:00Z')).stale, true, 'ちょうど24時間');
  const broken = freshness(makeEntry({ checkedAt: 'invalid' }), NOW);
  assert.equal(broken.stale, true);
  assert.equal(broken.hoursAgo, Infinity);
  assert.equal(STALE_HOURS, 24);
});

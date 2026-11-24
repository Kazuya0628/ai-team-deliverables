import { AREA_IDS } from './areas.js';
import { MAX_ADULTS, NIGHTS, ROOMS } from './conditions.js';
import { addDays, isValidDate } from './dates.js';

/**
 * 登録できる金額は「1部屋あたり・泊数合計・税込」だけ。
 * 1人あたりの料金をうっかり登録しないため、priceBasis がこの値と一致しないデータは表示しない。
 */
export const PRICE_BASIS = 'perRoomStayTaxIncluded';

/** 食事条件の種類 */
export const MEAL_CODES = Object.freeze(['none', 'breakfast', 'dinner', '2meals']);

/** 確認からこの時間を過ぎたデータは「要再確認」の表示になる */
export const STALE_HOURS = 24;

/** 必須の文字列項目 */
export const REQUIRED_TEXT_FIELDS = Object.freeze(['id', 'hotelName', 'location', 'roomType', 'planName', 'sourceLabel', 'evidence']);

const HTTPS_URL = /^https:\/\/[^\s<>"']+$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function isFilledText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function parseCheckedAt(value) {
  if (typeof value !== 'string' || !ISO_DATETIME.test(value)) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * 確認済みデータ1件を検証し、問題のメッセージ一覧を返す（空配列なら問題なし）。
 */
export function validateEntry(entry, { now } = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return ['1件分のデータはオブジェクトである必要があります'];
  }
  const errors = [];

  for (const field of REQUIRED_TEXT_FIELDS) {
    if (!isFilledText(entry[field])) errors.push(`${field} を記入してください`);
  }
  if (!AREA_IDS.includes(entry.areaId)) errors.push(`areaId が不正です（${String(entry.areaId)}）`);
  if (!Number.isInteger(entry.priceTotal) || entry.priceTotal < 0) {
    errors.push('priceTotal は0以上の整数（円）で指定してください');
  }
  if (entry.priceBasis !== PRICE_BASIS) {
    errors.push(`priceBasis は "${PRICE_BASIS}" にしてください（1人あたりの料金は登録できません）`);
  }

  const meal = entry.meal;
  if (!meal || typeof meal !== 'object' || !MEAL_CODES.includes(meal.code) || !isFilledText(meal.label)) {
    errors.push('meal は { code, label } の形で指定してください（code は none / breakfast / dinner / 2meals）');
  }

  if (!entry.cancellation || typeof entry.cancellation !== 'object' || !isFilledText(entry.cancellation.text)) {
    errors.push('cancellation は { text } の形で指定してください（キャンセル条件。確認できていないなら「未確認」と書く）');
  }

  const cond = entry.conditions;
  if (!cond || typeof cond !== 'object' || Array.isArray(cond)) {
    errors.push('conditions（空室を確認したときの条件）を指定してください');
  } else {
    if (!isValidDate(cond.checkin)) {
      errors.push('conditions.checkin が正しい日付ではありません');
    } else if (cond.checkout !== addDays(cond.checkin, NIGHTS)) {
      errors.push(`conditions.checkout は conditions.checkin の${NIGHTS}日後にしてください`);
    }
    if (!Number.isInteger(cond.adults) || cond.adults < 1 || cond.adults > MAX_ADULTS) {
      errors.push(`conditions.adults は1〜${MAX_ADULTS}の整数で指定してください`);
    }
    if (cond.rooms !== ROOMS) {
      errors.push(`conditions.rooms は ${ROOMS} にしてください`);
    }
  }

  if (typeof entry.planUrl !== 'string' || !HTTPS_URL.test(entry.planUrl.trim())) {
    errors.push('planUrl は https で始まる予約ページのURLにしてください');
  }

  const checkedMs = parseCheckedAt(entry.checkedAt);
  if (checkedMs === null) {
    errors.push('checkedAt はタイムゾーン付きの日時（例: 2026-11-24T19:10:00+09:00）で指定してください');
  } else if (now && checkedMs > now.getTime() + 10 * 60 * 1000) {
    errors.push('checkedAt が未来の日時になっています');
  }

  return errors;
}

/**
 * データファイル全体を検証する。問題のある件は表示対象から外し、その内容を problems にまとめる。
 */
export function validateDataset(data, { now = new Date() } = {}) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.entries)) {
    return { ok: false, problems: ['データファイルの形式が正しくありません（entries が見つかりません）'], entries: [] };
  }
  const problems = [];
  if (data.schemaVersion !== 1) problems.push('schemaVersion は 1 にしてください');
  if (data.priceBasis !== undefined && data.priceBasis !== PRICE_BASIS) {
    problems.push(`priceBasis は "${PRICE_BASIS}" にしてください`);
  }

  const entries = [];
  const seenIds = new Set();
  data.entries.forEach((raw, index) => {
    const errors = validateEntry(raw, { now });
    if (errors.length === 0 && seenIds.has(raw.id)) errors.push(`id が重複しています（${raw.id}）`);
    if (errors.length > 0) {
      const label = raw && typeof raw.id === 'string' && raw.id !== '' ? raw.id : `${index + 1}件目`;
      problems.push(`${label}: ${errors.join(' / ')}`);
      return;
    }
    seenIds.add(raw.id);
    entries.push(raw);
  });
  return { ok: problems.length === 0, problems, entries };
}

/** その宿を「いま選ばれている条件と同じ条件」で確認した場合だけ true（日付・人数・部屋数の完全一致） */
export function matchesConditions(entry, cond) {
  const c = entry.conditions;
  return c.checkin === cond.checkin && c.checkout === cond.checkout && c.adults === cond.adults && c.rooms === cond.rooms;
}

/**
 * 検索条件に合う確認済みデータを、1部屋総額の安い順に返す。
 * - 日付・人数・部屋数が確認時の条件と完全に一致したものだけ
 * - 選んだエリア内のものだけ
 * - 予算（1部屋総額）以内のものだけ（budget が null なら上限なし）
 * - チェックイン日を過ぎたものは除外
 */
export function selectStays(entries, cond, { today }) {
  if (!isValidDate(today)) throw new TypeError('today は \'YYYY-MM-DD\' 形式で指定してください');
  const areas = new Set(cond.areaIds);
  const items = entries.filter(
    (entry) =>
      matchesConditions(entry, cond) &&
      areas.has(entry.areaId) &&
      (cond.budget === null || entry.priceTotal <= cond.budget) &&
      entry.conditions.checkin >= today,
  );
  return items.sort(compareStays);
}

function compareStays(a, b) {
  if (a.priceTotal !== b.priceTotal) return a.priceTotal - b.priceTotal;
  const ta = parseCheckedAt(a.checkedAt);
  const tb = parseCheckedAt(b.checkedAt);
  if (ta !== tb) return tb - ta; // 同額なら、新しい確認を先に
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 確認からの経過時間（時間）と、STALE_HOURS を過ぎたかどうかを返す */
export function freshness(entry, now = new Date()) {
  const checkedMs = parseCheckedAt(entry.checkedAt);
  const hoursAgo = checkedMs === null ? Infinity : Math.max(0, (now.getTime() - checkedMs) / 3600000);
  return { hoursAgo, stale: hoursAgo >= STALE_HOURS };
}

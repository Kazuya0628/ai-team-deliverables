import { AREA_IDS } from './areas.js';
import { addDays, isValidDate, nextFriday } from './dates.js';

/** 1部屋あたりの大人の最大人数 */
export const MAX_ADULTS = 4;
/** 部屋数（このアプリでは1部屋固定） */
export const ROOMS = 1;
/** 泊数（このアプリでは1泊固定） */
export const NIGHTS = 1;
/** 予算の初期値。1部屋あたり・泊数合計・税込の円（1人あたりではない）。「従来の熱海ウォッチ」の条件を引き継いだ値 */
export const DEFAULT_BUDGET = 10000;
export const MAX_BUDGET = 10000000;

/**
 * 検索条件の初期値を作る。
 * チェックインは today（'YYYY-MM-DD'）以降で最も近い金曜日、1泊、大人4名、1部屋、1部屋総額10,000円以内、全エリア。
 */
export function defaultConditions({ today, adults = MAX_ADULTS, budget = DEFAULT_BUDGET, areaIds = AREA_IDS } = {}) {
  const checkin = nextFriday(today);
  return {
    checkin,
    checkout: addDays(checkin, NIGHTS),
    nights: NIGHTS,
    adults,
    rooms: ROOMS,
    budget,
    areaIds: [...areaIds],
  };
}

/**
 * 検索条件を検証して正規化する。
 * 入力はフォームや URL パラメータ由来の文字列でもよい。
 * 結果は { ok, errors, value }。ok が false のとき errors に日本語のメッセージが入る。
 */
export function normalizeConditions(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const errors = [];
  const value = {
    checkin: '',
    checkout: '',
    nights: NIGHTS,
    adults: MAX_ADULTS,
    rooms: ROOMS,
    budget: DEFAULT_BUDGET,
    areaIds: [...AREA_IDS],
  };

  // チェックイン日（チェックアウト日は常にその翌日）
  const checkin = typeof src.checkin === 'string' ? src.checkin.trim() : '';
  if (!isValidDate(checkin)) {
    errors.push('チェックイン日を正しい日付で指定してください');
  } else {
    value.checkin = checkin;
    value.checkout = addDays(checkin, NIGHTS);
  }

  // 大人人数
  const rawAdults = src.adults === undefined || src.adults === null || src.adults === '' ? MAX_ADULTS : src.adults;
  const adults = Number(typeof rawAdults === 'string' ? rawAdults.trim() : rawAdults);
  if (!Number.isInteger(adults) || adults < 1 || adults > MAX_ADULTS) {
    errors.push(`大人は1〜${MAX_ADULTS}名で指定してください`);
  } else {
    value.adults = adults;
  }

  // 予算（1部屋総額）。null・空文字・'none' は「上限なし」。未指定なら初期値
  let budget = DEFAULT_BUDGET;
  if (src.budget === null) {
    budget = null;
  } else if (src.budget !== undefined) {
    const budgetText = String(src.budget).trim();
    if (budgetText === '' || budgetText.toLowerCase() === 'none') {
      budget = null;
    } else {
      const parsed = Number(budgetText);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_BUDGET) {
        errors.push(`予算は0〜${MAX_BUDGET}円の整数で指定してください（「上限なし」も選べます）`);
      } else {
        budget = parsed;
      }
    }
  }
  value.budget = budget;

  // エリア（定義順に並べ替える）
  let rawAreas = src.areaIds;
  if (rawAreas === undefined || rawAreas === null) rawAreas = AREA_IDS;
  else if (!Array.isArray(rawAreas)) rawAreas = String(rawAreas).split(',');
  const picked = [...new Set(rawAreas.map((a) => String(a).trim()).filter((a) => a !== ''))];
  const unknown = picked.filter((a) => !AREA_IDS.includes(a));
  if (unknown.length > 0) errors.push(`不明なエリアが含まれています（${unknown.join(', ')}）`);
  if (picked.length === 0) errors.push('エリアを1つ以上選んでください');
  value.areaIds = AREA_IDS.filter((id) => picked.includes(id));

  return { ok: errors.length === 0, errors, value };
}

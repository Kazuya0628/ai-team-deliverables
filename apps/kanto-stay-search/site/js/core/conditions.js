import { AREA_IDS } from './areas.js';
import { addDays, isValidDate, nextFriday } from './dates.js';

/**
 * 人数・部屋数・泊数・予算はこのアプリで固定。
 * 宿データは「大人4名・1部屋・1部屋総額10,000円以下」で確認・取得するため、
 * 画面や URL で指定できるのはチェックイン日とエリアだけ（値は従来の熱海ウォッチの条件を引き継いだもの）。
 */

/** 1部屋あたりの大人の人数（固定）。登録できるデータの人数の上限（1〜4名）にも使う */
export const MAX_ADULTS = 4;
/** 部屋数（固定） */
export const ROOMS = 1;
/** 泊数（固定） */
export const NIGHTS = 1;
/** 1部屋あたり・泊数合計・税込の上限（円。1人あたりではない）。固定値で、画面では変更できない */
export const DEFAULT_BUDGET = 10000;

/**
 * 検索条件の初期値を作る。
 * チェックインは today（'YYYY-MM-DD'）以降で最も近い金曜日。1泊・大人4名・1部屋・1部屋総額10,000円以下は固定。全エリア。
 */
export function defaultConditions({ today, areaIds = AREA_IDS } = {}) {
  const checkin = nextFriday(today);
  return {
    checkin,
    checkout: addDays(checkin, NIGHTS),
    nights: NIGHTS,
    adults: MAX_ADULTS,
    rooms: ROOMS,
    budget: DEFAULT_BUDGET,
    areaIds: [...areaIds],
  };
}

/**
 * 検索条件を検証して正規化する。
 * 入力はフォームや URL パラメータ由来の文字列でもよい。
 * 読むのはチェックイン日（checkin）とエリア（areaIds）だけ。
 * 人数・部屋数・泊数・予算は固定で、入力に adults・rooms・nights・budget が含まれていても読まず、常に固定の値を返す。
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

  // 大人人数・部屋数・泊数・予算は固定（上の value のとおり。入力は読まない）

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

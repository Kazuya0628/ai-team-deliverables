/**
 * 日付ユーティリティ（依存ライブラリなし。ブラウザと Node の両方で動く）。
 *
 * - 日付はすべて 'YYYY-MM-DD' 形式の文字列で扱う
 * - 日付どうしの計算は UTC 基準で行う（実行環境のタイムゾーンに左右されないようにするため）
 * - 「今日」の判定だけは日本時間（JST）で行う
 */

export const TZ = 'Asia/Tokyo';
export const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' 形式で、実在する日付なら true（例: '2026-02-30' は false） */
export function isValidDate(value) {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function toUtc(dateStr) {
  if (!isValidDate(dateStr)) {
    throw new TypeError(`日付は 'YYYY-MM-DD' 形式で指定してください（${String(dateStr)}）`);
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Date オブジェクト（UTC の日付部分）を 'YYYY-MM-DD' にする */
export function toIsoDate(dt) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${String(dt.getUTCFullYear()).padStart(4, '0')}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function partsInTz(now, options) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now は有効な Date である必要があります');
  }
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...options }).formatToParts(now);
  const pick = (type) => {
    const part = parts.find((p) => p.type === type);
    return part ? part.value : '';
  };
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
}

/** 日本時間（JST）での「今日」を 'YYYY-MM-DD' で返す */
export function todayJst(now = new Date()) {
  const p = partsInTz(now, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

/** 現在時刻を、タイムゾーン付きの ISO 8601 形式（JST）で返す。例: '2026-11-24T19:10:05+09:00' */
export function nowJstIso(now = new Date()) {
  const p = partsInTz(now, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+09:00`;
}

export function addDays(dateStr, days) {
  const dt = toUtc(dateStr);
  dt.setUTCDate(dt.getUTCDate() + days);
  return toIsoDate(dt);
}

/** to が from から何日後か（to が前なら負の数） */
export function diffDays(from, to) {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS);
}

/** 曜日を漢字1字（日〜土）で返す */
export function weekdayJa(dateStr) {
  return WEEKDAYS_JA[toUtc(dateStr).getUTCDay()];
}

export function isFriday(dateStr) {
  return toUtc(dateStr).getUTCDay() === 5;
}

/** 曜日を0〜6の整数で返す（0=日曜、5=金曜、6=土曜）。カレンダーのマスの並びなどに使う */
export function weekdayIndex(dateStr) {
  return toUtc(dateStr).getUTCDay();
}

/**
 * from 以降で最も近い金曜日を返す。
 * inclusive が true なら from 自身が金曜のとき from を返す（false なら翌週の金曜）。
 */
export function nextFriday(from, { inclusive = true } = {}) {
  const offset = (5 - toUtc(from).getUTCDay() + 7) % 7;
  if (offset === 0 && !inclusive) return addDays(from, 7);
  return addDays(from, offset);
}

/** from 以降の金曜日を、直近のものから count 件返す */
export function upcomingFridays(from, count = 4, options = {}) {
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  const first = nextFriday(from, options);
  return Array.from({ length: n }, (_, i) => addDays(first, 7 * i));
}

/** '2026-11-27' → '11月27日（金）' */
export function formatJpDate(dateStr) {
  if (!isValidDate(dateStr)) return '';
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}月${d}日（${weekdayJa(dateStr)}）`;
}

/** タイムゾーン付きの日時文字列を、日本時間の 'YYYY/MM/DD HH:mm' にして返す（無効な値は ''） */
export function formatJpDateTime(value) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  const p = partsInTz(dt, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

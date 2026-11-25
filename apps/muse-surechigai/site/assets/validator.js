// 事例カードの検証ロジック。
// ブラウザ（site/assets/app.js から import）と Node（tools/validate-data.js・tests/ から
// import）の両方で使う共通モジュール。schema/*.schema.json と同じルールの実装。
// 外部パッケージなしで動く。

export const PACK_FORMAT = 'muse-surechigai-pack';
export const PACK_VERSION = 1;

export const CARD_FIELDS = [
  'id',
  'displayName',
  'artifactName',
  'tagline',
  'category',
  'tech',
  'link',
  'learning',
  'createdAt'
];

export const REQUIRED_CARD_FIELDS = [
  'id',
  'artifactName',
  'tagline',
  'category',
  'tech',
  'learning',
  'createdAt'
];

export const CATEGORIES = [
  'アプリ',
  'Webサイト',
  'ツール',
  'ゲーム',
  '記事・文章',
  '画像・動画',
  'データ',
  '調査・レポート',
  'その他'
];

export const LIMITS = {
  id: 64,
  displayName: 40,
  artifactName: 80,
  tagline: 140,
  techItem: 30,
  techCount: 8,
  link: 500,
  learning: 140,
  packNote: 200,
  packCards: 50
};

export const PACK_FIELDS = ['format', 'packVersion', 'exportedAt', 'note', 'sample', 'cards'];

const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXPORTED_AT_RE =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// サロゲートペアを壊さない文字数（コードポイント数）
function charCount(str) {
  return [...str].length;
}

export function isValidDateString(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function todayDateString(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * カード1枚を検証する。
 * @param {*} card - 検証する値
 * @param {{ label?: string, now?: Date }} opts - label はエラーメッセージの接頭辞
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateCard(card, opts = {}) {
  const label = opts.label ?? 'カード';
  const errors = [];
  const warnings = [];

  if (!isPlainObject(card)) {
    errors.push(`${label}: オブジェクトである必要があります`);
    return { ok: false, errors, warnings };
  }

  const unknown = Object.keys(card).filter((k) => !CARD_FIELDS.includes(k));
  if (unknown.length > 0) {
    errors.push(
      `${label}: 使えない項目があります（${unknown.join('、')}）。使えるのは ${CARD_FIELDS.join('・')}`
    );
  }

  // id（必須）
  if (!('id' in card)) {
    errors.push(`${label}: id がありません`);
  } else if (typeof card.id !== 'string') {
    errors.push(`${label}: id は文字列にしてください`);
  } else if (!ID_RE.test(card.id)) {
    errors.push(
      `${label}: id は半角小英字・数字・ハイフンで、先頭と末尾をハイフンにできない・64字までです（例: my-app-01）`
    );
  }

  // displayName（任意・文字列または null）
  if ('displayName' in card && card.displayName !== null) {
    const v = card.displayName;
    if (typeof v !== 'string') {
      errors.push(`${label}: displayName は文字列か null にしてください`);
    } else {
      const trimmed = v.trim();
      if (trimmed.length === 0) {
        errors.push(`${label}: displayName を空にする場合は、null（匿名）にしてください`);
      } else if (charCount(trimmed) > LIMITS.displayName) {
        errors.push(`${label}: displayName は${LIMITS.displayName}字までです`);
      }
      if (trimmed.includes('@')) {
        warnings.push(
          `${label}: displayName に「@」が含まれています。メールアドレスやSNSのアカウント名は個人情報を含めない設計に反します。確認してください`
        );
      }
    }
  }

  // artifactName（必須）
  if (!('artifactName' in card)) {
    errors.push(`${label}: artifactName（作ったものの名前）がありません`);
  } else if (typeof card.artifactName !== 'string' || card.artifactName.trim().length === 0) {
    errors.push(`${label}: artifactName は空でない文字列にしてください`);
  } else if (charCount(card.artifactName.trim()) > LIMITS.artifactName) {
    errors.push(`${label}: artifactName は${LIMITS.artifactName}字までです`);
  }

  // tagline（必須）
  if (!('tagline' in card)) {
    errors.push(`${label}: tagline（ひとこと説明）がありません`);
  } else if (typeof card.tagline !== 'string' || card.tagline.trim().length === 0) {
    errors.push(`${label}: tagline は空でない文字列にしてください`);
  } else if (charCount(card.tagline.trim()) > LIMITS.tagline) {
    errors.push(`${label}: tagline は${LIMITS.tagline}字までです`);
  }

  // category（必須・列挙）
  if (!('category' in card)) {
    errors.push(`${label}: category がありません`);
  } else if (!CATEGORIES.includes(card.category)) {
    errors.push(
      `${label}: category は次のうちから1つ選んでください（受け取った値: ${JSON.stringify(card.category)}）: ${CATEGORIES.join('／')}`
    );
  }

  // tech（必須・配列）
  if (!('tech' in card)) {
    errors.push(`${label}: tech（使った技術）がありません`);
  } else if (!Array.isArray(card.tech)) {
    errors.push(`${label}: tech は文字列の配列にしてください`);
  } else {
    if (card.tech.length < 1) {
      errors.push(`${label}: tech は1個以上にしてください`);
    }
    if (card.tech.length > LIMITS.techCount) {
      errors.push(`${label}: tech は${LIMITS.techCount}個までにしてください`);
    }
    card.tech.forEach((t, i) => {
      if (typeof t !== 'string' || t.trim().length === 0) {
        errors.push(`${label}: tech の${i + 1}番目は空でない文字列にしてください`);
      } else if (charCount(t.trim()) > LIMITS.techItem) {
        errors.push(`${label}: tech の${i + 1}番目は${LIMITS.techItem}字までです`);
      }
    });
    const seen = new Set();
    for (const t of card.tech) {
      const key = typeof t === 'string' ? t.trim() : String(t);
      if (seen.has(key)) {
        warnings.push(`${label}: tech に重複があります（${key}）`);
        break;
      }
      seen.add(key);
    }
  }

  // link（任意・文字列または null・https のみ）
  if ('link' in card && card.link !== null) {
    const v = card.link;
    if (typeof v !== 'string') {
      errors.push(`${label}: link は文字列か null にしてください`);
    } else if (v.trim().length === 0) {
      errors.push(`${label}: link を空にする場合は、null にしてください`);
    } else {
      if (/\s/.test(v)) {
        errors.push(`${label}: link に空白や改行を含められません`);
      }
      if (!v.startsWith('https://')) {
        errors.push(`${label}: link は https:// で始まるURLにしてください（例: https://example.com/）`);
      }
      try {
        const u = new URL(v);
        if (u.hostname.length === 0) errors.push(`${label}: link のURLが正しくないようです（ホスト名がない）`);
      } catch {
        errors.push(`${label}: link のURLが正しくないようです`);
      }
      if (charCount(v) > LIMITS.link) {
        errors.push(`${label}: link は${LIMITS.link}字までです`);
      }
    }
  }

  // learning（必須）
  if (!('learning' in card)) {
    errors.push(`${label}: learning（ひとこと学び）がありません`);
  } else if (typeof card.learning !== 'string' || card.learning.trim().length === 0) {
    errors.push(`${label}: learning は空でない文字列にしてください`);
  } else if (charCount(card.learning.trim()) > LIMITS.learning) {
    errors.push(`${label}: learning は${LIMITS.learning}字までです`);
  }

  // createdAt（必須・YYYY-MM-DD・実在する日）
  if (!('createdAt' in card)) {
    errors.push(`${label}: createdAt（作成日）がありません`);
  } else if (!isValidDateString(card.createdAt)) {
    errors.push(`${label}: createdAt は実在する日付で、YYYY-MM-DD の形にしてください（例: 2026-11-25）`);
  } else if (card.createdAt > todayDateString(opts.now ?? new Date())) {
    warnings.push(`${label}: createdAt が未来の日付になっています。確認してください`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * カードパック（入れ物）を検証する。
 * @param {*} pack
 * @param {{ now?: Date }} opts
 * @returns {{ ok: boolean, errors: string[], warnings: string[], cards: object[], sample: boolean, note: string }}
 */
export function validatePack(pack, opts = {}) {
  const errors = [];
  const warnings = [];
  let cards = [];
  let sample = false;
  let note = '';

  if (!isPlainObject(pack)) {
    errors.push('パック: オブジェクトである必要があります');
    return { ok: false, errors, warnings, cards, sample, note };
  }

  const unknown = Object.keys(pack).filter(
    (k) => !PACK_FIELDS.includes(k) && k !== '$schema'
  );
  if (unknown.length > 0) {
    errors.push(`パック: 使えない項目があります（${unknown.join('、')}）。使えるのは ${PACK_FIELDS.join('・')}`);
  }

  if (pack.format !== PACK_FORMAT) {
    errors.push(
      `パック: format は "${PACK_FORMAT}" にしてください（受け取った値: ${JSON.stringify(pack.format)}）`
    );
  }
  if (pack.packVersion !== PACK_VERSION) {
    errors.push(`パック: packVersion は ${PACK_VERSION} にしてください（受け取った値: ${JSON.stringify(pack.packVersion)}）`);
  }

  if ('exportedAt' in pack && pack.exportedAt !== undefined) {
    if (typeof pack.exportedAt !== 'string' || !EXPORTED_AT_RE.test(pack.exportedAt) ||
        Number.isNaN(Date.parse(pack.exportedAt))) {
      warnings.push('パック: exportedAt は ISO 8601 の日時（例: 2026-11-25T09:00:00+09:00）にすると親切です');
    }
  }

  if ('note' in pack && pack.note !== undefined) {
    if (typeof pack.note !== 'string') {
      errors.push('パック: note は文字列にしてください');
    } else if (charCount(pack.note.trim()) > LIMITS.packNote) {
      errors.push(`パック: note は${LIMITS.packNote}字までです`);
    } else {
      note = pack.note.trim();
    }
  }

  if ('sample' in pack && pack.sample !== undefined) {
    if (typeof pack.sample !== 'boolean') {
      errors.push('パック: sample は true か false にしてください');
    } else {
      sample = pack.sample;
      if (sample && note.length > 0 && !/サンプル|架空/.test(note)) {
        warnings.push('パック: sample: true のときは、note に「サンプル」「架空」のどちらかの文字を入れるのがルールです');
      }
    }
  }

  if (!('cards' in pack)) {
    errors.push('パック: cards（カードの配列）がありません');
  } else if (!Array.isArray(pack.cards)) {
    errors.push('パック: cards は配列にしてください');
  } else {
    if (pack.cards.length < 1) {
      errors.push('パック: cards は1件以上にしてください');
    }
    if (pack.cards.length > LIMITS.packCards) {
      errors.push(`パック: cards は${LIMITS.packCards}件までにしてください`);
    }
    const seenIds = new Map();
    pack.cards.slice(0, LIMITS.packCards).forEach((card, i) => {
      const r = validateCard(card, { label: `cards[${i}]`, now: opts.now });
      errors.push(...r.errors);
      warnings.push(...r.warnings);
      if (isPlainObject(card) && typeof card.id === 'string') {
        if (seenIds.has(card.id)) {
          errors.push(`パック: cards の id が重複しています（${card.id}・${seenIds.get(card.id)}番目と${i}番目）`);
        } else {
          seenIds.set(card.id, i);
        }
      }
    });
    if (errors.length === 0) cards = pack.cards;
  }

  return { ok: errors.length === 0, errors, warnings, cards, sample, note };
}

/**
 * すれ違いで受け取ったJSONの中身を読み込む。
 * 「カードパック」が基本だが、「カードの配列」「カード1枚」も受け付ける。
 * @param {*} value - JSON.parse() の結果
 * @param {{ now?: Date }} opts
 * @returns {{ ok: boolean, cards: object[], sample: boolean, note: string, errors: string[], warnings: string[] }}
 */
export function parseImport(value, opts = {}) {
  if (isPlainObject(value)) {
    if ('format' in value) {
      const r = validatePack(value, opts);
      return { ok: r.ok, cards: r.cards, sample: r.sample, note: r.note, errors: r.errors, warnings: r.warnings };
    }
    // format のないオブジェクトは「カード1枚」として扱う
    const r = validateCard(value, { label: 'カード', now: opts.now });
    return { ok: r.ok, cards: r.ok ? [value] : [], sample: false, note: '', errors: r.errors, warnings: r.warnings };
  }
  if (Array.isArray(value)) {
    const errors = [];
    const warnings = [];
    if (value.length < 1) errors.push('配列が空です。カードが1件以上必要です');
    if (value.length > LIMITS.packCards) {
      errors.push(`カードは一度に${LIMITS.packCards}件までにしてください（受け取った件数: ${value.length}）`);
    }
    const seenIds = new Map();
    value.slice(0, LIMITS.packCards).forEach((card, i) => {
      const r = validateCard(card, { label: `cards[${i}]`, now: opts.now });
      errors.push(...r.errors);
      warnings.push(...r.warnings);
      if (isPlainObject(card) && typeof card.id === 'string') {
        if (seenIds.has(card.id)) {
          errors.push(`cards の id が重複しています（${card.id}）`);
        } else {
          seenIds.set(card.id, i);
        }
      }
    });
    return { ok: errors.length === 0, cards: errors.length === 0 ? value : [], sample: false, note: '', errors, warnings };
  }
  return {
    ok: false,
    cards: [],
    sample: false,
    note: '',
    errors: [
      '読み込めるのは次のどれかのJSONです: ①カードパック（format, packVersion, cards） ②カードの配列 ③カード1枚'
    ],
    warnings: []
  };
}

/**
 * 書き出し用のカードパックを組み立てる。
 * @param {object[]} cards - 検証済みのカードの配列
 * @param {{ note?: string, sample?: boolean, exportedAt?: Date }} opts
 */
export function buildPack(cards, opts = {}) {
  const pack = {
    format: PACK_FORMAT,
    packVersion: PACK_VERSION,
    exportedAt: (opts.exportedAt ?? new Date()).toISOString(),
    cards
  };
  if (opts.note) pack.note = opts.note;
  if (opts.sample) pack.sample = true;
  return pack;
}

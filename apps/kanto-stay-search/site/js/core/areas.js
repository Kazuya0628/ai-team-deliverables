/**
 * エリアの定義。
 * id はデータファイル（verified.json）・外部サイトの定義（sources.json）・URL パラメータで使うので、変更しないこと。
 */
export const AREAS = Object.freeze(
  [
    { id: 'tokyo', label: '東京', note: '' },
    { id: 'kanagawa', label: '神奈川', note: '' },
    { id: 'chiba', label: '千葉', note: '' },
    { id: 'saitama', label: '埼玉', note: '' },
    { id: 'ibaraki', label: '茨城', note: '' },
    { id: 'tochigi', label: '栃木', note: '' },
    { id: 'gunma', label: '群馬', note: '' },
    { id: 'shizuoka-east', label: '静岡東部', note: '熱海・伊東・伊豆・三島・沼津・御殿場など' },
  ].map((area) => Object.freeze(area)),
);

export const AREA_IDS = Object.freeze(AREAS.map((area) => area.id));

/** エリアの表示名を返す（未知の id は ''） */
export function areaLabel(areaId) {
  const area = AREAS.find((a) => a.id === areaId);
  return area ? area.label : '';
}

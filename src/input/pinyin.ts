export interface PinyinCandidate { text: string; consumed: number }
export class PinyinIndex {
  private buckets = new Map<string, [string, string][]>();
  constructor(entries: [string, string][]) {
    for (const entry of entries) {
      const key = entry[1][0];
      const bucket = this.buckets.get(key) || [];
      bucket.push(entry);
      this.buckets.set(key, bucket);
    }
  }
  candidates(input: string, limit = 30): PinyinCandidate[] {
    const query = input.toLowerCase().replace(/['\s]/g, '').replace(/ü/g, 'v');
    if (!/^[a-zv]+$/.test(query)) return [];
    const exact: PinyinCandidate[] = [], prefix: PinyinCandidate[] = [], partial: PinyinCandidate[] = [];
    let consumed = 0;
    for (const [text, spelling] of this.buckets.get(query[0]) || []) {
      if (spelling === query) exact.push({ text, consumed: query.length });
      else if (spelling.startsWith(query)) prefix.push({ text, consumed: query.length });
      else if (query.startsWith(spelling)) {
        if (spelling.length > consumed) { consumed = spelling.length; partial.length = 0; }
        if (spelling.length === consumed) partial.push({ text, consumed });
      }
    }
    const seen = new Set<string>();
    return [...exact, ...prefix, ...partial].filter(candidate => {
      if (seen.has(candidate.text)) return false;
      seen.add(candidate.text);
      return true;
    }).slice(0, limit);
  }
}

let dictionary: Promise<PinyinIndex> | undefined;
export function loadPinyin() {
  if (!dictionary) dictionary = fetch(new URL('/ime/pinyin.json', window.location.href))
    .then(async response => {
      if (!response.ok) throw new Error('拼音词库加载失败');
      return new PinyinIndex(await response.json());
    }).catch(error => { dictionary = undefined; throw error; });
  return dictionary;
}

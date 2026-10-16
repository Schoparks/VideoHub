import Graphemer from 'graphemer';

const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }) : undefined;
const fallback = new Graphemer();
export function replaceText(value: string, text: string, start = value.length, end = start) {
  return { value: value.slice(0, start) + text + value.slice(end), caret: start + text.length };
}
export function deleteText(value: string, start = value.length, end = start) {
  if (start !== end) return replaceText(value, '', start, end);
  const prefix = value.slice(0, start);
  const previous = segmenter
    ? [...segmenter.segment(prefix)].at(-1)?.index ?? 0
    : start - (fallback.splitGraphemes(prefix).at(-1)?.length ?? 0);
  return replaceText(value, '', previous, start);
}

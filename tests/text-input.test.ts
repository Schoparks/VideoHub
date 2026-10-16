import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PinyinIndex } from '../src/input/pinyin';
import { deleteText, replaceText } from '../src/input/text-editing';

describe('text editing', () => {
  it('inserts at the caret and replaces a selection', () => {
    expect(replaceText('hello world', '映集', 6, 11)).toEqual({ value: 'hello 映集', caret: 8 });
    expect(replaceText('ab', 'X', 1)).toEqual({ value: 'aXb', caret: 2 });
  });
  it('deletes a selected range or one complete grapheme without splitting emoji', () => {
    expect(deleteText('a👨‍👩‍👧‍👦')).toEqual({ value: 'a', caret: 1 });
    expect(deleteText('café')).toEqual({ value: 'caf', caret: 3 });
    expect(deleteText('abc', 1, 2)).toEqual({ value: 'ac', caret: 1 });
    expect(deleteText('abc', 0)).toEqual({ value: 'abc', caret: 0 });
  });
  it('keeps emoji and combining marks intact when the television has no Intl.Segmenter', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!;
    try {
      Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
      vi.resetModules();
      const legacy = await import('../src/input/text-editing');
      expect(legacy.deleteText('a👨‍👩‍👧‍👦')).toEqual({ value: 'a', caret: 1 });
      expect(legacy.deleteText('café')).toEqual({ value: 'caf', caret: 3 });
      expect(legacy.deleteText('国🇨🇳')).toEqual({ value: '国', caret: 1 });
      expect(legacy.deleteText('abc', 0)).toEqual({ value: 'abc', caret: 0 });
    } finally {
      Object.defineProperty(Intl, 'Segmenter', descriptor);
      vi.resetModules();
    }
  });
});

describe('offline pinyin dictionary', () => {
  it('finds phrases and retains the unconsumed suffix during multi-word input', () => {
    const index = new PinyinIndex([['是', 'shi'], ['西', 'xi'], ['幸福', 'xingfu'], ['终点', 'zhongdian']]);
    expect(index.candidates('xingfu')[0]).toEqual({ text: '幸福', consumed: 6 });
    expect(index.candidates('xingfuzhongdian')[0]).toEqual({ text: '幸福', consumed: 6 });
    expect(index.candidates('XING')[0].text).toBe('幸福');
    expect(index.candidates('123')).toEqual([]);
  });
  it('loads the shipped dictionary and supports ordinary words beyond demonstration phrases', async () => {
    const entries = JSON.parse(await readFile('public/ime/pinyin.json', 'utf8'));
    expect(entries.length).toBe(55320);
    const index = new PinyinIndex(entries);
    for (const [pinyin, text] of [['xingfu', '幸福'], ['zhongdian', '终点'], ['shurufa', '输入法'], ['xihongshi', '西红柿']]) {
      expect(index.candidates(pinyin).some(candidate => candidate.text === text)).toBe(true);
    }
    expect(index.candidates('shi')).toHaveLength(30);
  });
});

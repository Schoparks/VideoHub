import { describe, expect, it } from 'vitest';
import { mergeBrowsePage } from '../src/hooks/browsePagination';
import type { DynamicItem, MediaItem, Page } from '../src/shared/types';

const item = (id: string): MediaItem => ({ id, source: 'bilibili', kind: 'video', title: id });
const page = (ids: string[], options: Partial<Page> = {}): Page => ({ items: ids.map(item), hasMore: true, ...options });
const dynamic = (id: string): DynamicItem => ({ id, author: '作者', text: id, images: [], url: `https://t.bilibili.com/${id}` });

describe('generic browse pagination', () => {
  it('preserves server order and existing cards while removing duplicates within and between pages', () => {
    const first = mergeBrowsePage('followingLive', undefined, page(['3', '1', '3']));
    const next = mergeBrowsePage('followingLive', first.data, page(['1', '4', '2', '4']), first.progress);
    expect(first.data.items.map(item => item.id)).toEqual(['3', '1']);
    expect(next.data.items.map(item => item.id)).toEqual(['3', '1', '4', '2']);
    expect(next.data.items[0]).toBe(first.data.items[0]);
    expect(next.data.hasMore).toBe(true);
    expect(next.progress.emptyPages).toBe(0);
  });

  it('stops after five consecutive empty or duplicate pages and resets the count after growth', () => {
    let result = mergeBrowsePage('favorites', undefined, page(['1']));
    for (let index = 1; index <= 4; index++) {
      result = mergeBrowsePage('favorites', result.data, page(index % 2 ? [] : ['1']), result.progress);
      expect(result.data.hasMore).toBe(true);
      expect(result.progress.emptyPages).toBe(index);
    }
    result = mergeBrowsePage('favorites', result.data, page(['2']), result.progress);
    expect(result.progress.emptyPages).toBe(0);
    for (let index = 1; index <= 5; index++) {
      result = mergeBrowsePage('favorites', result.data, page(['1', '2']), result.progress);
      expect(result.data.hasMore).toBe(index < 5);
    }
    expect(result.data.items.map(item => item.id)).toEqual(['1', '2']);
  });

  it('counts text and image dynamics as new content without requiring video cards', () => {
    let result = mergeBrowsePage('dynamic', undefined, page([], { dynamics: [dynamic('1')], cursor: 'a' }));
    for (let index = 2; index <= 7; index++) {
      result = mergeBrowsePage('dynamic', result.data, page([], {
        dynamics: [dynamic('1'), dynamic(String(index)), dynamic(String(index))],
        cursor: `offset-${index}`,
      }), result.progress);
      expect(result.data.hasMore).toBe(true);
      expect(result.progress.emptyPages).toBe(0);
    }
    expect(result.data.dynamics?.map(item => item.id)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(result.data.items).toEqual([]);
  });

  it.each(['history', 'dynamic'] as const)('halts repeated and cyclic %s cursors', kind => {
    const first = mergeBrowsePage(kind, undefined, page(['1'], { cursor: 'a' }));
    const repeat = mergeBrowsePage(kind, first.data, page(['2'], { cursor: 'a' }), first.progress);
    expect(repeat.data.hasMore).toBe(false);
    expect(repeat.data.items.map(item => item.id)).toEqual(['1', '2']);
    const next = mergeBrowsePage(kind, first.data, page(['2'], { cursor: 'b' }), first.progress);
    const cycle = mergeBrowsePage(kind, next.data, page(['3'], { cursor: 'a' }), next.progress);
    expect(next.data.hasMore).toBe(true);
    expect(cycle.data.hasMore).toBe(false);
  });

  it('allows numbered search pages to reuse a cursor containing only active categories', () => {
    const first = mergeBrowsePage('search', undefined, page(['1'], { cursor: 'active-types' }));
    const next = mergeBrowsePage('search', first.data, page(['2'], { cursor: 'active-types' }), first.progress);
    expect(next.data.hasMore).toBe(true);
  });

  it('starts fresh without stale cards, stopped cursors or empty-page counts', () => {
    const first = mergeBrowsePage('history', undefined, page(['1'], { cursor: 'a' }));
    const stopped = mergeBrowsePage('history', first.data, page(['1'], { cursor: 'a' }), first.progress);
    const refreshed = mergeBrowsePage('history', undefined, page(['2'], { cursor: 'a' }), stopped.progress);
    expect(refreshed.data.items.map(item => item.id)).toEqual(['2']);
    expect(refreshed.data.hasMore).toBe(true);
    expect(refreshed.progress.emptyPages).toBe(0);
  });

  it('honors the server end even when the last page contains additional cards', () => {
    const first = mergeBrowsePage('cinema', undefined, page(['1']));
    const next = mergeBrowsePage('cinema', first.data, page(['2'], { hasMore: false }), first.progress);
    expect(next.data.hasMore).toBe(false);
    expect(next.data.items.map(item => item.id)).toEqual(['1', '2']);
  });

  it('bounds a feed that never returns any content', () => {
    let result = mergeBrowsePage('regions', undefined, page([]));
    for (let index = 2; index <= 5; index++) {
      result = mergeBrowsePage('regions', result.data, page([]), result.progress);
      expect(result.data.hasMore).toBe(index < 5);
    }
  });
});

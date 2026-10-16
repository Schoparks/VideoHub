import { describe, expect, it } from 'vitest';
import { coverUrl, thumbnailUrl } from '../src/shared/images';

describe('presentation artwork thumbnails', () => {
  it('requests bounded, proportional sizes through the same public transport', () => {
    const source = '//i0.hdslb.com/bfs/live/room.jpg';
    expect(thumbnailUrl(source)).toBe('https://i0.hdslb.com/bfs/live/room.jpg@960w_960h.webp');
    expect(thumbnailUrl(source, 160)).toContain('@160w_160h.webp');
    expect(thumbnailUrl(source, 1440)).toContain('@1440w_1440h.webp');
    expect(new URL(coverUrl(thumbnailUrl(source), true)!).searchParams.get('url')).toBe(thumbnailUrl(source));
    expect(source).toBe('//i0.hdslb.com/bfs/live/room.jpg');
  });

  it('replaces an existing transform once and preserves the original image identity', () => {
    const source = 'http://i0.hdslb.com/a.png@11520w_8640h_1c.webp';
    const thumbnail = thumbnailUrl(source)!;
    expect(thumbnail).toBe('https://i0.hdslb.com/a.png@960w_960h.webp');
    expect(thumbnailUrl(thumbnail)).toBe(thumbnail);
    expect(thumbnailUrl('//i0.hdslb.com/folder@name/a.jpg')).toContain('/folder@name/a.jpg@960w_960h.webp');
  });

  it('leaves external, signed, animated and unknown images intact', () => {
    for (const source of ['https://example.com/a.jpg', 'https://i0.hdslb.com/a.jpg?signature=value',
      'https://i0.hdslb.com/a.gif', 'https://i0.hdslb.com/a.gif@160w.webp',
      'https://i0.hdslb.com/a', 'https://i0.hdslb.com/a.svg',
      'https://i0.hdslb.com:8443/a.jpg', 'https://hdslb.com.evil.test/a.jpg']) {
      expect(thumbnailUrl(source)).toBe(source);
    }
    expect(thumbnailUrl('javascript:alert(1)')).toBeUndefined();
    expect(thumbnailUrl('https://user:secret@i0.hdslb.com/a.jpg')).toBeUndefined();
  });
});

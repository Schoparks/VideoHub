import { describe, expect, it } from 'vitest';
import { schemas } from '../electron/ipc';
import { defaultPreferences } from '../src/shared/types';

describe('card layout preference compatibility', () => {
  it('accepts legacy preferences without resetting their playback choices', () => {
    const { cardColumns: _columns, ...legacy } = defaultPreferences;
    const [preferences] = schemas.preferences.parse([{ ...legacy, autoNext: false, volume: .4 }]);
    expect(preferences).toMatchObject({ cardColumns: 0, autoNext: false, volume: .4 });
  });
  it.each([0, 2, 3, 4, 5, 6])('accepts supported column count %s', cardColumns => {
    expect(schemas.preferences.safeParse([{ ...defaultPreferences, cardColumns }]).success).toBe(true);
  });
  it.each([-1, 1, 2.5, 7, Infinity])('rejects unsupported column count %s', cardColumns => {
    expect(schemas.preferences.safeParse([{ ...defaultPreferences, cardColumns }]).success).toBe(false);
  });
});

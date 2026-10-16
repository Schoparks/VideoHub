import { describe, expect, it } from 'vitest';
import { resumePosition } from '../src/shared/playback-progress';

describe('resume and history display policy', () => {
  it('resumes unfinished media at its exact position', () => {
    expect(resumePosition({ position: 37.456, duration: 120 })).toBe(37.456);
  });
  it('restarts at and inside the existing final-ten-seconds threshold', () => {
    expect(resumePosition({ position: 109.99, duration: 120 })).toBe(109.99);
    for (const position of [110, 115, 120]) expect(resumePosition({ position, duration: 120 })).toBe(0);
  });
  it('retains progress when duration is unknown', () => {
    expect(resumePosition({ position: 42, duration: 0 })).toBe(42);
  });
  it('has no resume action without recorded progress', () => {
    expect(resumePosition()).toBe(0);
    expect(resumePosition({ position: 0, duration: 120 })).toBe(0);
  });
});

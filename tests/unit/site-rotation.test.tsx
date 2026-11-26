import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextIndex, ROTATE_MS, useRotation } from '../../site/src/lib/rotation';

describe('hero rotation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('wraps around the slides', () => {
    expect(nextIndex(0, 5)).toBe(1);
    expect(nextIndex(4, 5)).toBe(0);
    expect(nextIndex(0, 0)).toBe(0);
  });

  it('advances every 5 seconds while playing', () => {
    const { result } = renderHook(() => useRotation(5, false));
    expect(result.current.playing).toBe(true);
    act(() => vi.advanceTimersByTime(ROTATE_MS - 1));
    expect(result.current.index).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.index).toBe(1);
  });

  it('stops advancing when paused and resumes when played', () => {
    const { result } = renderHook(() => useRotation(5, false));
    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(ROTATE_MS * 3));
    expect(result.current.index).toBe(0);
    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(ROTATE_MS));
    expect(result.current.index).toBe(1);
  });

  it('starts paused for reduced-motion visitors and pauses if the preference turns on', () => {
    const reduced = renderHook(() => useRotation(5, true));
    act(() => vi.advanceTimersByTime(ROTATE_MS * 2));
    expect(reduced.result.current).toMatchObject({ playing: false, index: 0 });

    const { result, rerender } = renderHook(({ rm }) => useRotation(5, rm), { initialProps: { rm: false } });
    rerender({ rm: true });
    act(() => vi.advanceTimersByTime(ROTATE_MS * 2));
    expect(result.current).toMatchObject({ playing: false, index: 0 });
  });
});

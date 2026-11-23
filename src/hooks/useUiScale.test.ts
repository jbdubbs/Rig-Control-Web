import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUiScale, readStoredScale } from './useUiScale';

describe('useUiScale', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.zoom = '';
    delete (window as { electron?: unknown }).electron;
  });

  it('defaults to 100% and leaves <html> zoom unset', () => {
    const { result } = renderHook(() => useUiScale());
    expect(result.current.scale).toBe(1);
    expect(document.documentElement.style.zoom).toBe('');
  });

  it('steps up, applies CSS zoom in a browser, and persists', () => {
    const { result } = renderHook(() => useUiScale());
    act(() => result.current.increase());
    act(() => result.current.increase());
    expect(result.current.scale).toBe(1.5);
    expect(document.documentElement.style.zoom).toBe('1.5');
    expect(localStorage.getItem('ui-scale')).toBe('1.5');
    expect(readStoredScale()).toBe(1.5);
  });

  it('reset returns to 100% and clears the zoom', () => {
    localStorage.setItem('ui-scale', '2');
    const { result } = renderHook(() => useUiScale());
    expect(result.current.scale).toBe(2);
    act(() => result.current.reset());
    expect(result.current.scale).toBe(1);
    expect(document.documentElement.style.zoom).toBe('');
  });

  it('uses Electron zoom instead of CSS zoom when the bridge exists', () => {
    const calls: number[] = [];
    (window as { electron?: unknown }).electron = { setZoomFactor: (f: number) => calls.push(f) };
    const { result } = renderHook(() => useUiScale());
    act(() => result.current.increase());
    expect(calls).toEqual([1, 1.25]);
    expect(document.documentElement.style.zoom).toBe('');
  });

  it('disables stepping at the limits', () => {
    localStorage.setItem('ui-scale', '3');
    const { result } = renderHook(() => useUiScale());
    expect(result.current.canIncrease).toBe(false);
    expect(result.current.canDecrease).toBe(true);
  });
});

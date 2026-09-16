import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLayoutConfig } from './useLayoutConfig';
import type { GridItem } from '../types/layout';

beforeEach(() => {
  localStorage.clear();
});

function setCompactItems(
  result: { current: ReturnType<typeof useLayoutConfig> },
  items: GridItem[],
  cols = 3,
) {
  act(() => {
    result.current.setCompactLayout({ cols, rows: 10, items });
  });
}

describe('useLayoutConfig addPanel — compact column placement', () => {
  it('places a new panel in the column with the fewest existing items when no targetX is given', () => {
    const { result } = renderHook(() => useLayoutConfig());
    setCompactItems(result, [
      { i: 'a', x: 0, y: 0, w: 1, h: 1, panelType: 'controls' },
      { i: 'b', x: 0, y: 1, w: 1, h: 1, panelType: 'rflevels' },
    ]);

    act(() => {
      result.current.addPanel('compact', 'solar');
    });

    const added = result.current.compactLayout.items.find(i => i.panelType === 'solar');
    // No targetX supplied -> falls back to legacy behavior (column 0).
    expect(added?.x).toBe(0);
  });

  it('places a new panel in the explicitly targeted column, stacked below existing items there', () => {
    const { result } = renderHook(() => useLayoutConfig());
    setCompactItems(result, [
      { i: 'a', x: 0, y: 0, w: 1, h: 1, panelType: 'controls' },
      { i: 'b', x: 1, y: 0, w: 1, h: 2, panelType: 'spectrum_hamlib' },
    ]);

    act(() => {
      result.current.addPanel('compact', 'solar', { targetX: 1 });
    });

    const added = result.current.compactLayout.items.find(i => i.panelType === 'solar');
    expect(added?.x).toBe(1);
    // Stacked below item 'b' (y:0, h:2), not appended after the global max.
    expect(added?.y).toBe(2);
  });

  it('ignores targetX for full-width panels and keeps them at x:0', () => {
    const { result } = renderHook(() => useLayoutConfig());
    setCompactItems(result, [
      { i: 'a', x: 0, y: 0, w: 1, h: 1, panelType: 'controls' },
      { i: 'b', x: 1, y: 0, w: 1, h: 1, panelType: 'smeter' },
    ]);

    act(() => {
      result.current.addPanel('compact', 'vfo', { fullWidth: true, targetX: 1 });
    });

    const added = result.current.compactLayout.items.find(i => i.panelType === 'vfo');
    expect(added?.x).toBe(0);
    expect(added?.w).toBe(9999);
  });

  it('does not apply targetX-based placement to the phone view', () => {
    const { result } = renderHook(() => useLayoutConfig());
    act(() => {
      result.current.setPhoneLayout({
        cols: 1,
        rows: 10,
        items: [{ i: 'a', x: 0, y: 0, w: 1, h: 1, panelType: 'controls' }],
      });
    });

    act(() => {
      result.current.addPanel('phone', 'solar', { targetX: 0 });
    });

    const added = result.current.phoneLayout.items.find(i => i.panelType === 'solar');
    // Phone view always appends at the global max y, regardless of targetX.
    expect(added?.x).toBe(0);
    expect(added?.y).toBe(1);
  });
});

// The hook mounts before auth resolves (callsign ""), then re-renders with the real
// callsign once login completes. setCompactLayout/setPhoneLayout/addPanel/setGridSize/
// updateItemPositions must pick up the new callsign-derived storage key at that point,
// not keep writing to the stale unprefixed key captured on first render.
describe('useLayoutConfig storage key tracks callsign after it resolves post-mount', () => {
  it('addPanel writes to the callsign-prefixed key, not the stale unprefixed one', () => {
    const { result, rerender } = renderHook(
      ({ callsign }: { callsign: string }) => useLayoutConfig(callsign),
      { initialProps: { callsign: '' } },
    );

    rerender({ callsign: 'W1AW' });

    act(() => {
      result.current.addPanel('compact', 'solar');
    });

    expect(localStorage.getItem('grid-layout-v1')).toBeNull();
    const stored = JSON.parse(localStorage.getItem('W1AW:grid-layout-v1')!);
    expect(stored.compact.items.some((i: GridItem) => i.panelType === 'solar')).toBe(true);
  });

  it('setGridSize writes to the callsign-prefixed key, not the stale unprefixed one', () => {
    const { result, rerender } = renderHook(
      ({ callsign }: { callsign: string }) => useLayoutConfig(callsign),
      { initialProps: { callsign: '' } },
    );

    rerender({ callsign: 'W1AW' });

    act(() => {
      result.current.setGridSize('compact', 4, 8);
    });

    expect(localStorage.getItem('grid-layout-v1')).toBeNull();
    const stored = JSON.parse(localStorage.getItem('W1AW:grid-layout-v1')!);
    expect(stored.compact.cols).toBe(4);
    expect(stored.compact.rows).toBe(8);
  });
});

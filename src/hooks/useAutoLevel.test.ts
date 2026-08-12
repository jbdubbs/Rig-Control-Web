import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutoLevel } from './useAutoLevel';

const lsKey = (name: string) => `TEST:spectrum-hamlib-${name}`;

const defaults = {
  lsKey,
  manualFloorDefault: -80,
  manualCeilingDefault: -40,
};

// Mostly-noise-floor array with a handful of stronger "signal" bins, so p10
// tracks the noise and p99 tracks the signal without the floor/ceiling
// safety clamp (a render-safe minimum gap) needing to intervene.
function synthFrame(noiseDb: number, signalDb: number, totalBins = 200, signalBins = 10): Float32Array {
  const arr = new Float32Array(totalBins).fill(noiseDb);
  for (let i = 0; i < signalBins; i++) arr[i] = signalDb;
  return arr;
}

beforeEach(() => {
  localStorage.clear();
});

describe('useAutoLevel', () => {
  it('starts with manual defaults and Auto off', () => {
    const { result } = renderHook(() => useAutoLevel({ ...defaults, sourceSuffix: '' }));

    expect(result.current.floor).toBe(-80);
    expect(result.current.ceiling).toBe(-40);
    expect(result.current.autoFloor).toBe(false);
    expect(result.current.autoCeiling).toBe(false);
  });

  it('persists manual floor/ceiling and auto toggles to localStorage under the per-source keys', () => {
    const { result } = renderHook(() => useAutoLevel({ ...defaults, sourceSuffix: '' }));

    act(() => result.current.setFloor(-90));
    act(() => result.current.setAutoCeiling(true));

    expect(localStorage.getItem(lsKey('floor'))).toBe('-90');
    expect(localStorage.getItem(lsKey('autoCeiling'))).toBe('true');

    // A fresh mount picks up the persisted values.
    const { result: result2 } = renderHook(() => useAutoLevel({ ...defaults, sourceSuffix: '' }));
    expect(result2.current.floor).toBe(-90);
    expect(result2.current.autoCeiling).toBe(true);
  });

  it('tracks auto-scale state per source independently', () => {
    const { result, rerender } = renderHook(
      ({ sourceSuffix }) => useAutoLevel({ ...defaults, sourceSuffix }),
      { initialProps: { sourceSuffix: '' } },
    );

    act(() => result.current.setAutoFloor(true));
    // Feed hamlib source a noisy-with-signal frame.
    act(() => result.current.sampleFrame(synthFrame(-70, -20), 0));
    const hamlibFloor = result.current.getEffectiveFloor();
    expect(hamlibFloor).toBeCloseTo(-70 - 5, 0);

    rerender({ sourceSuffix: '-ft4222' });
    act(() => result.current.setAutoFloor(true));
    // ft4222's tracker starts fresh, unaffected by hamlib's tracked state.
    act(() => result.current.sampleFrame(synthFrame(-100, -50), 1000));
    const ft4222Floor = result.current.getEffectiveFloor();
    expect(ft4222Floor).toBeCloseTo(-100 - 5, 0);
    expect(ft4222Floor).not.toBeCloseTo(hamlibFloor, 0);

    // Switching back to hamlib resumes its own previously-tracked state.
    rerender({ sourceSuffix: '' });
    expect(result.current.getEffectiveFloor()).toBeCloseTo(hamlibFloor, 0);
  });

  it('resetAutoScale clears tracked state so the next sample re-seeds cold', () => {
    const { result } = renderHook(() => useAutoLevel({ ...defaults, sourceSuffix: '' }));

    act(() => result.current.setAutoCeiling(true));
    act(() => result.current.sampleFrame(new Float32Array(200).fill(-10), 0));
    expect(result.current.getEffectiveCeiling()).toBeCloseTo(-10 + 3, 0);

    act(() => result.current.resetAutoScale());
    act(() => result.current.sampleFrame(new Float32Array(200).fill(-70), 5000));
    expect(result.current.getEffectiveCeiling()).toBeCloseTo(-70 + 3, 0);
  });

  it('sampleFrame does not trigger a React re-render on every call (ref-based, rAF-safe)', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useAutoLevel({ ...defaults, sourceSuffix: '' });
    });

    const before = renders;
    act(() => {
      for (let i = 0; i < 10; i++) {
        result.current.sampleFrame(new Float32Array(50).fill(-60), i * 10);
      }
    });
    // Only the throttled ~250ms display-sync should ever cause a state update;
    // 10 samples spanning 100ms total should produce at most one such sync.
    expect(renders - before).toBeLessThanOrEqual(1);
  });
});

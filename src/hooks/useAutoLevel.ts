import { useCallback, useEffect, useRef, useState } from "react";
import {
  createAutoLevelState,
  stepAutoLevel,
  type AutoLevelOptions,
  type AutoLevelState,
} from "../utils/autoLevel";

const DISPLAY_SYNC_INTERVAL_MS = 250;

function lsGet(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function lsGetBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === "true";
  } catch {
    return fallback;
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

interface UseAutoLevelParams {
  lsKey: (name: string) => string;
  sourceSuffix: string;
  manualFloorDefault: number;
  manualCeilingDefault: number;
  // Per-source algorithm tuning (e.g. a higher floorPercentile for a source
  // whose raw bins are a single-look/un-averaged estimate — see autoLevel.ts).
  algorithmOptions?: Partial<AutoLevelOptions>;
}

export function useAutoLevel({ lsKey, sourceSuffix, manualFloorDefault, manualCeilingDefault, algorithmOptions }: UseAutoLevelParams) {
  const floorKey = `floor${sourceSuffix}`;
  const ceilingKey = `ceiling${sourceSuffix}`;
  const autoFloorKey = `autoFloor${sourceSuffix}`;
  const autoCeilingKey = `autoCeiling${sourceSuffix}`;

  const [floor, setFloorState] = useState(() => Number(lsGet(lsKey(floorKey), String(manualFloorDefault))));
  const [ceiling, setCeilingState] = useState(() => Number(lsGet(lsKey(ceilingKey), String(manualCeilingDefault))));
  const [autoFloor, setAutoFloorState] = useState(() => lsGetBool(lsKey(autoFloorKey), false));
  const [autoCeiling, setAutoCeilingState] = useState(() => lsGetBool(lsKey(autoCeilingKey), false));
  const [displayFloor, setDisplayFloor] = useState(manualFloorDefault);
  const [displayCeiling, setDisplayCeiling] = useState(manualCeilingDefault);

  const setFloor = useCallback((v: number) => {
    setFloorState(v);
    lsSet(lsKey(floorKey), String(v));
  }, [lsKey, floorKey]);
  const setCeiling = useCallback((v: number) => {
    setCeilingState(v);
    lsSet(lsKey(ceilingKey), String(v));
  }, [lsKey, ceilingKey]);
  const setAutoFloor = useCallback((v: boolean) => {
    setAutoFloorState(v);
    lsSet(lsKey(autoFloorKey), String(v));
  }, [lsKey, autoFloorKey]);
  const setAutoCeiling = useCallback((v: boolean) => {
    setAutoCeilingState(v);
    lsSet(lsKey(autoCeilingKey), String(v));
  }, [lsKey, autoCeilingKey]);

  // Auto-tracked numeric state deliberately lives only in this ref, keyed by
  // source, and is never persisted — Auto mode always re-adapts from scratch
  // on mount rather than resuming a possibly-stale prior session's estimate.
  const statesRef = useRef<Record<string, AutoLevelState>>({});
  const lastSyncRef = useRef(0);

  const getState = useCallback((): AutoLevelState => {
    let s = statesRef.current[sourceSuffix];
    if (!s) {
      s = createAutoLevelState();
      statesRef.current[sourceSuffix] = s;
    }
    return s;
  }, [sourceSuffix]);

  const sampleFrame = useCallback((dbValues: ArrayLike<number>, nowMs: number) => {
    const prev = getState();
    const next = stepAutoLevel(
      prev,
      dbValues,
      nowMs,
      autoFloor ? null : floor,
      autoCeiling ? null : ceiling,
      algorithmOptions,
    );
    statesRef.current[sourceSuffix] = next;

    if (nowMs - lastSyncRef.current >= DISPLAY_SYNC_INTERVAL_MS) {
      lastSyncRef.current = nowMs;
      setDisplayFloor(next.displayFloorDb);
      setDisplayCeiling(next.displayCeilingDb);
    }
  }, [getState, autoFloor, autoCeiling, floor, ceiling, sourceSuffix, algorithmOptions]);

  const getEffectiveFloor = useCallback(() => getState().displayFloorDb, [getState]);
  const getEffectiveCeiling = useCallback(() => getState().displayCeilingDb, [getState]);

  const resetAutoScale = useCallback(() => {
    statesRef.current[sourceSuffix] = createAutoLevelState();
    setDisplayFloor(autoFloor ? manualFloorDefault : floor);
    setDisplayCeiling(autoCeiling ? manualCeilingDefault : ceiling);
  }, [sourceSuffix, autoFloor, autoCeiling, floor, ceiling, manualFloorDefault, manualCeilingDefault]);

  // Re-sync manual/auto state from localStorage when the active source
  // changes (mirrors the pre-existing per-source reset behavior), and
  // refresh the throttled display snapshot for that source's tracker.
  useEffect(() => {
    setFloorState(Number(lsGet(lsKey(floorKey), String(manualFloorDefault))));
    setCeilingState(Number(lsGet(lsKey(ceilingKey), String(manualCeilingDefault))));
    setAutoFloorState(lsGetBool(lsKey(autoFloorKey), false));
    setAutoCeilingState(lsGetBool(lsKey(autoCeilingKey), false));
    const s = getState();
    setDisplayFloor(s.displayFloorDb || manualFloorDefault);
    setDisplayCeiling(s.displayCeilingDb || manualCeilingDefault);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSuffix]);

  return {
    floor,
    setFloor,
    ceiling,
    setCeiling,
    autoFloor,
    setAutoFloor,
    autoCeiling,
    setAutoCeiling,
    displayFloor,
    displayCeiling,
    resetAutoScale,
    sampleFrame,
    getEffectiveFloor,
    getEffectiveCeiling,
  };
}

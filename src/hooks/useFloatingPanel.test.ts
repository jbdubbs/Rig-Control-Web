import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { normalizeSearchText, useFloatingPanel } from "./useFloatingPanel";

function makeTriggerRef(rect: Partial<DOMRect>) {
  const el = document.createElement("button");
  el.getBoundingClientRect = () => ({
    top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
    toJSON: () => ({}),
    ...rect,
  }) as DOMRect;
  return { current: el };
}

describe("normalizeSearchText", () => {
  it("lowercases and strips non-alphanumeric characters", () => {
    expect(normalizeSearchText("IC-7300 Radio!")).toBe("ic7300radio");
  });
});

describe("useFloatingPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("positions the panel below the trigger when there is more room below", () => {
    vi.stubGlobal("innerHeight", 800);
    const triggerRef = makeTriggerRef({ top: 100, bottom: 130, left: 20, width: 200 });
    const panelRef = createRef<HTMLDivElement>();
    const { result } = renderHook(() =>
      useFloatingPanel({ isOpen: false, triggerRef, panelRef, onClose: () => {}, panelMaxHeight: 280 })
    );

    act(() => result.current.positionPanel());

    expect(result.current.panelStyle).toMatchObject({
      position: "fixed",
      left: 20,
      width: 200,
      top: 134,
    });
    expect(result.current.panelStyle.bottom).toBeUndefined();
  });

  it("flips above the trigger when there is not enough room below", () => {
    vi.stubGlobal("innerHeight", 300);
    const triggerRef = makeTriggerRef({ top: 250, bottom: 280, left: 0, width: 100 });
    const panelRef = createRef<HTMLDivElement>();
    const { result } = renderHook(() =>
      useFloatingPanel({ isOpen: false, triggerRef, panelRef, onClose: () => {}, panelMaxHeight: 280 })
    );

    act(() => result.current.positionPanel());

    expect(result.current.panelStyle.bottom).toBe(300 - 250 + 4);
    expect(result.current.panelStyle.top).toBeUndefined();
  });

  it("clamps maxHeight to at least 100 even when available space is smaller", () => {
    vi.stubGlobal("innerHeight", 50);
    const triggerRef = makeTriggerRef({ top: 20, bottom: 30, left: 0, width: 100 });
    const panelRef = createRef<HTMLDivElement>();
    const { result } = renderHook(() =>
      useFloatingPanel({ isOpen: false, triggerRef, panelRef, onClose: () => {}, panelMaxHeight: 280 })
    );

    act(() => result.current.positionPanel());

    expect(result.current.panelStyle.maxHeight).toBe(100);
  });

  it("closes on an outside pointerdown while open", () => {
    const triggerRef = makeTriggerRef({});
    const panelEl = document.createElement("div");
    document.body.appendChild(panelEl);
    const panelRef = { current: panelEl };
    const onClose = vi.fn();
    renderHook(() =>
      useFloatingPanel({ isOpen: true, triggerRef, panelRef, onClose, panelMaxHeight: 280 })
    );

    act(() => {
      document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    document.body.removeChild(panelEl);
  });

  it("does not close when the pointerdown target is inside the panel", () => {
    const triggerRef = makeTriggerRef({});
    const panelEl = document.createElement("div");
    document.body.appendChild(panelEl);
    const panelRef = { current: panelEl };
    const onClose = vi.fn();
    renderHook(() =>
      useFloatingPanel({ isOpen: true, triggerRef, panelRef, onClose, panelMaxHeight: 280 })
    );

    act(() => {
      panelEl.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
    document.body.removeChild(panelEl);
  });

  it("does not attach outside-close listeners while closed", () => {
    const triggerRef = makeTriggerRef({});
    const panelRef = createRef<HTMLDivElement>();
    const onClose = vi.fn();
    renderHook(() =>
      useFloatingPanel({ isOpen: false, triggerRef, panelRef, onClose, panelMaxHeight: 280 })
    );

    act(() => {
      document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});

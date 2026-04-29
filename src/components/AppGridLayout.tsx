import React, { useMemo, useCallback } from 'react';
import { ReactGridLayout, useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import type { GridItem, ViewLayout } from '../types/layout';

interface AppGridLayoutProps {
  viewLayout: ViewLayout;
  isEditMode: boolean;
  renderPanel: (item: GridItem) => React.ReactNode;
  onItemsChange?: (items: GridItem[]) => void;
  onDropOnto?: (targetId: string, sourceId: string) => void;
  rowHeight?: number;
  className?: string;
}

export default function AppGridLayout({
  viewLayout,
  isEditMode,
  renderPanel,
  onItemsChange,
  onDropOnto,
  rowHeight = 180,
  className,
}: AppGridLayoutProps) {
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 800 });

  const gridConfig = useMemo(() => ({
    cols: viewLayout.cols,
    rowHeight,
    margin: [8, 8] as [number, number],
    containerPadding: [0, 0] as [number, number],
  }), [viewLayout.cols, rowHeight]);

  const dragConfig = useMemo(() => ({
    enabled: isEditMode,
    handle: '.grid-drag-handle',
    threshold: 4,
  }), [isEditMode]);

  const resizeConfig = useMemo(() => ({
    enabled: isEditMode,
    handles: ['se'] as ['se'],
  }), [isEditMode]);

  const handleLayoutChange = useCallback((layout: readonly { i: string; x: number; y: number; w: number; h: number }[]) => {
    if (!onItemsChange) return;
    const posMap = new Map(layout.map(l => [l.i, l]));
    const updated: GridItem[] = viewLayout.items.map(item => {
      const pos = posMap.get(item.i);
      return pos ? { ...item, x: pos.x, y: pos.y, w: pos.w, h: pos.h } : item;
    });
    onItemsChange(updated);
  }, [onItemsChange, viewLayout.items]);

  const handleDragStop = useCallback((_layout: unknown, _old: unknown, newItem: { i: string; x: number; y: number; w: number; h: number }) => {
    if (!onDropOnto) return;
    // Find if newItem overlaps any other item
    const overlapping = viewLayout.items.find(item => {
      if (item.i === newItem.i) return false;
      return (
        newItem.x < item.x + item.w &&
        newItem.x + newItem.w > item.x &&
        newItem.y < item.y + item.h &&
        newItem.y + newItem.h > item.y
      );
    });
    if (overlapping) {
      onDropOnto(overlapping.i, newItem.i);
    }
  }, [onDropOnto, viewLayout.items]);

  return (
    <div ref={containerRef} className={className}>
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={viewLayout.items as any}
          gridConfig={gridConfig}
          dragConfig={dragConfig}
          resizeConfig={resizeConfig}
          onLayoutChange={handleLayoutChange as any}
          onDragStop={handleDragStop as any}
          autoSize={true}
        >
          {viewLayout.items.map(item => (
            <div key={item.i} className="overflow-hidden h-full">
              {renderPanel(item)}
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
}

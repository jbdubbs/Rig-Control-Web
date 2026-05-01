// NOTE: AppGridLayout is no longer used by any layout (CompactLayout switched to a natural-height
// column renderer in CoreUpdate2). Preserved here for potential future use.
import React, { useMemo, useCallback } from 'react';
import { ReactGridLayout, useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { cn } from '../utils';
import type { GridItem, ViewLayout } from '../types/layout';

const MARGIN = 8;

interface AppGridLayoutProps {
  viewLayout: ViewLayout;
  isEditMode: boolean;
  renderPanel: (item: GridItem) => React.ReactNode;
  onItemsChange?: (items: GridItem[]) => void;
  rowHeight?: number;
  className?: string;
}

export default function AppGridLayout({
  viewLayout,
  isEditMode,
  renderPanel,
  onItemsChange,
  rowHeight = 180,
  className,
}: AppGridLayoutProps) {
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 800 });

  const gridConfig = useMemo(() => ({
    cols: viewLayout.cols,
    rowHeight,
    margin: [MARGIN, MARGIN] as [number, number],
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

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={viewLayout.items as any}
          gridConfig={gridConfig}
          dragConfig={dragConfig}
          resizeConfig={resizeConfig}
          onLayoutChange={handleLayoutChange as any}
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

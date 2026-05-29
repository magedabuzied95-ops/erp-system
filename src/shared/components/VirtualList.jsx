import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

export function useVirtualRows({
  count,
  estimateSize,
  overscan = 6,
  scrollRef,
  enabled = true,
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const size = useElementSize(scrollRef);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !enabled) return undefined;
    const handleScroll = () => setScrollTop(element.scrollTop || 0);
    handleScroll();
    element.addEventListener("scroll", handleScroll, { passive: true });
    return () => element.removeEventListener("scroll", handleScroll);
  }, [enabled, scrollRef]);

  return useMemo(() => {
    if (!enabled || count <= 0 || estimateSize <= 0) {
      return { items: Array.from({ length: count }, (_, index) => index), totalSize: 0, paddingTop: 0, paddingBottom: 0 };
    }
    const viewportHeight = size.height || scrollRef.current?.clientHeight || 0;
    const startIndex = clamp(Math.floor(scrollTop / estimateSize) - overscan, 0, Math.max(0, count - 1));
    const visibleCount = Math.ceil(viewportHeight / estimateSize) + overscan * 2;
    const endIndex = clamp(startIndex + visibleCount, startIndex, count);
    const items = Array.from({ length: Math.max(0, endIndex - startIndex) }, (_, index) => startIndex + index);
    const totalSize = count * estimateSize;
    const paddingTop = startIndex * estimateSize;
    const paddingBottom = Math.max(0, totalSize - paddingTop - items.length * estimateSize);
    return { items, totalSize, paddingTop, paddingBottom };
  }, [count, enabled, estimateSize, overscan, scrollRef, scrollTop, size.height]);
}

export const VirtualList = memo(function VirtualList({
  items = [],
  estimateSize = 88,
  overscan = 6,
  className = "",
  itemKey,
  renderItem,
}) {
  const scrollRef = useRef(null);
  const virtual = useVirtualRows({ count: items.length, estimateSize, overscan, scrollRef });
  const keyFor = useCallback((item, index) => itemKey?.(item, index) ?? index, [itemKey]);

  return (
    <div ref={scrollRef} className={className}>
      <div style={{ height: virtual.totalSize, position: "relative" }}>
        <div style={{ transform: `translateY(${virtual.paddingTop}px)` }}>
          {virtual.items.map((index) => {
            const item = items[index];
            return <div key={keyFor(item, index)}>{renderItem(item, index)}</div>;
          })}
        </div>
      </div>
    </div>
  );
});

export const VirtualGrid = memo(function VirtualGrid({
  items = [],
  columns = 2,
  estimateRowHeight = 340,
  overscan = 3,
  className = "",
  gridClassName = "",
  itemKey,
  renderItem,
}) {
  const scrollRef = useRef(null);
  const rowCount = Math.ceil(items.length / columns);
  const virtual = useVirtualRows({ count: rowCount, estimateSize: estimateRowHeight, overscan, scrollRef });
  const rows = useMemo(() => virtual.items.map((rowIndex) => {
    const start = rowIndex * columns;
    return { rowIndex, rowItems: items.slice(start, start + columns), start };
  }), [columns, items, virtual.items]);
  const keyFor = useCallback((item, index) => itemKey?.(item, index) ?? index, [itemKey]);

  return (
    <div ref={scrollRef} className={className}>
      <div style={{ height: virtual.totalSize, position: "relative" }}>
        <div className={gridClassName} style={{ transform: `translateY(${virtual.paddingTop}px)` }}>
          {rows.map(({ rowIndex, rowItems, start }) => (
            <div key={rowIndex} className="contents">
              {rowItems.map((item, offset) => renderItem(item, start + offset, keyFor(item, start + offset)))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

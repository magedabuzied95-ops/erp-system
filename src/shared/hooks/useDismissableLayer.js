import { useEffect, useId, useRef } from "react";

const DISMISSABLE_LAYER_OPEN_EVENT = "erp:dismissable-layer:open";

const asArray = (value) => (Array.isArray(value) ? value : [value]).filter(Boolean);

const nodeContainsTarget = (node, target) => {
  if (!node || !target) return false;
  if (node === target) return true;
  if (typeof node.contains === "function" && node.contains(target)) return true;
  const path = typeof target.composedPath === "function" ? target.composedPath() : [];
  return path.includes(node);
};

export function useDismissableLayer({
  enabled = true,
  refs = [],
  onDismiss,
  ignore,
  ignoreSelectors = [],
  dismissOnEscape = true,
  dismissOnPointerDownOutside = true,
  dismissOnLayerOpen = true,
} = {}) {
  const layerId = useId();
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!enabled || typeof document === "undefined" || typeof onDismissRef.current !== "function") return undefined;

    const protectedRefs = asArray(refs);
    const ignoredRefs = asArray(ignore);
    const ignoredSelectors = asArray(ignoreSelectors);
    const isInsideLayer = (target) =>
      protectedRefs.some((ref) => nodeContainsTarget(ref?.current || ref, target)) ||
      ignoredRefs.some((ref) => nodeContainsTarget(ref?.current || ref, target)) ||
      ignoredSelectors.some((selector) => typeof target?.closest === "function" && target.closest(selector));

    const handlePointerDown = (event) => {
      if (!dismissOnPointerDownOutside) return;
      if (isInsideLayer(event.target)) return;
      onDismissRef.current?.(event);
    };

    const handleKeyDown = (event) => {
      if (!dismissOnEscape || event.key !== "Escape") return;
      onDismissRef.current?.(event);
    };

    const handleLayerOpen = (event) => {
      if (!dismissOnLayerOpen || event.detail?.id === layerId) return;
      onDismissRef.current?.(event);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener(DISMISSABLE_LAYER_OPEN_EVENT, handleLayerOpen);
    window.dispatchEvent(new CustomEvent(DISMISSABLE_LAYER_OPEN_EVENT, { detail: { id: layerId } }));

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener(DISMISSABLE_LAYER_OPEN_EVENT, handleLayerOpen);
    };
  }, [
    enabled,
    layerId,
    dismissOnEscape,
    dismissOnPointerDownOutside,
    dismissOnLayerOpen,
  ]);
}

export default useDismissableLayer;

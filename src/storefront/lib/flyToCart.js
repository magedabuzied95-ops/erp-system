const FLY_TO_CART_DURATION = 350;

const hasReducedMotion = () => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

const getElementRect = (element) => {
  if (!element || typeof element.getBoundingClientRect !== "function") return null;
  const rect = element.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return rect;
};

const getSafeImageSource = (imageEl) => {
  if (!imageEl) return "";
  return imageEl.currentSrc || imageEl.src || imageEl.getAttribute?.("src") || "";
};

const setNodeStyles = (node, styles) => {
  if (!node) return;
  Object.assign(node.style, styles);
};

export function animateFlyToCart({ imageEl, cartEl }) {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (hasReducedMotion()) return false;
  if (!imageEl || !cartEl) return false;
  if (!imageEl.isConnected || !cartEl.isConnected) return false;
  if (typeof imageEl.getBoundingClientRect !== "function" || typeof cartEl.getBoundingClientRect !== "function") return false;

  const startRect = getElementRect(imageEl);
  const endRect = getElementRect(cartEl);
  if (!startRect || !endRect) return false;

  const startSize = Math.max(24, Math.min(72, Math.min(startRect.width, startRect.height)));
  const endSize = Math.max(18, Math.min(26, startSize * 0.34));
  const startCenterX = startRect.left + (startRect.width / 2);
  const startCenterY = startRect.top + (startRect.height / 2);
  const endCenterX = endRect.left + (endRect.width / 2);
  const endCenterY = endRect.top + (endRect.height / 2);
  const deltaX = endCenterX - startCenterX;
  const deltaY = endCenterY - startCenterY;
  const flyImage = document.createElement("img");
  const source = getSafeImageSource(imageEl);

  if (!source) return false;

  flyImage.alt = "";
  flyImage.src = source;
  flyImage.decoding = "async";
  flyImage.setAttribute("aria-hidden", "true");
  setNodeStyles(flyImage, {
    position: "fixed",
    left: `${startCenterX - (startSize / 2)}px`,
    top: `${startCenterY - (startSize / 2)}px`,
    width: `${startSize}px`,
    height: `${startSize}px`,
    pointerEvents: "none",
    margin: "0",
    zIndex: "2147483647",
    borderRadius: getComputedStyle(imageEl).borderRadius || "999px",
    objectFit: "contain",
    willChange: "transform, opacity",
    transform: "translate3d(0, 0, 0) scale(1)",
    opacity: "0.98",
    filter: "drop-shadow(0 8px 18px rgba(0, 0, 0, 0.18))",
  });

  document.body.appendChild(flyImage);

  const cleanup = () => {
    if (flyImage.isConnected) flyImage.remove();
  };

  const bounceCart = () => {
    if (!cartEl.isConnected || typeof cartEl.animate !== "function") return;
    try {
      cartEl.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(1.08)" },
          { transform: "scale(1)" },
        ],
        {
          duration: 180,
          easing: "cubic-bezier(0.2, 1, 0.3, 1)",
        }
      );
    } catch {
      // Ignore animation support failures.
    }
  };

  try {
    const animation = flyImage.animate(
      [
        { transform: "translate3d(0, 0, 0) scale(1)", opacity: 0.98 },
        {
          transform: `translate3d(${deltaX * 0.55}px, ${deltaY * 0.55}px, 0) scale(0.74)`,
          opacity: 0.82,
          offset: 0.58,
        },
        {
          transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${Math.max(0.22, endSize / startSize)})`,
          opacity: 0,
        },
      ],
      {
        duration: FLY_TO_CART_DURATION,
        easing: "cubic-bezier(0.2, 0.85, 0.25, 1)",
        fill: "forwards",
      }
    );

    animation.onfinish = () => {
      cleanup();
      bounceCart();
    };
    animation.oncancel = cleanup;
    return true;
  } catch {
    cleanup();
    return false;
  }
}

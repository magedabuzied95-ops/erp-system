import React, { useState } from "react";

const DefaultFallback = ({ message = "Content unavailable" }) => (
  <div className="flex h-full min-h-20 w-full items-center justify-center rounded-[var(--radius-card)] border border-dashed border-[var(--border)] bg-[var(--card)] p-4 text-center text-sm font-semibold text-[var(--muted)]">
    {message}
  </div>
);

export class SafeRender extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.props.onError?.(error, info);
    if (this.props.log !== false) {
      console.error("[SafeRender] render failed:", error);
      console.error("[SafeRender] componentStack:", info?.componentStack);
    }
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return <DefaultFallback message={this.props.message || "Content unavailable"} />;
    }

    return this.props.children;
  }
}

export const SafeImage = React.forwardRef(function SafeImage({
  src,
  alt = "",
  fallback,
  fallbackMessage = "Image unavailable",
  onError,
  ...props
}, ref) {
  const [failed, setFailed] = useState(false);
  const safeSrc = typeof src === "string" ? src.trim() : "";

  if (!safeSrc || failed) {
    return fallback !== undefined ? fallback : <DefaultFallback message={fallbackMessage} />;
  }

  return (
    <img
      {...props}
      ref={ref}
      src={safeSrc}
      alt={alt}
      onError={(event) => {
        setFailed(true);
        onError?.(event);
      }}
    />
  );
});

export default SafeRender;

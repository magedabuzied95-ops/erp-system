import React from "react";
import i18n from "../../i18n/i18n";
import {
  hasChunkReloadAttempted,
  isChunkLoadError,
  recoverFromChunkLoadError,
} from "../utils/chunkLoadRecovery";

function ChunkReloadFallback({ showAction = false }) {
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-stone-950 px-4 text-white">
      <div className="flex min-h-32 w-full max-w-md flex-col items-center justify-center text-center">
        <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-white" aria-hidden="true" />
        {showAction ? (
          <>
            <h1 className="m1-page-title mt-5">{i18n.t("common.reloadAfterUpdate")}</h1>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-full bg-white px-5 py-3 text-sm font-black text-stone-950"
            >
              {i18n.t("common.reload")}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default class DebugErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, showChunkAction: false };
    this.chunkActionTimer = null;
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[DebugErrorBoundary] error:", error);
    console.error("[DebugErrorBoundary] componentStack:", info?.componentStack);
    this.setState({ info });
    if (isChunkLoadError(error)) {
      recoverFromChunkLoadError(error);
      this.chunkActionTimer = window.setTimeout(() => {
        this.setState({ showChunkAction: true });
      }, 8_000);
    }
  }

  componentWillUnmount() {
    if (this.chunkActionTimer) window.clearTimeout(this.chunkActionTimer);
  }

  render() {
    const title = this.props.title || i18n.t(this.props.titleKey || "common.errorBoundary.screenCrashed");

    if (this.state.error) {
      if (isChunkLoadError(this.state.error)) {
        return <ChunkReloadFallback showAction={hasChunkReloadAttempted() && this.state.showChunkAction} />;
      }

      return (
        <div className="m-6 rounded-2xl border border-red-500/40 bg-red-950/40 p-6 text-red-100">
          <h1 className="m1-page-title">{title}</h1>
          <pre className="mt-4 whitespace-pre-wrap text-sm">
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <pre className="mt-4 whitespace-pre-wrap text-xs opacity-80">
            {String(this.state.info?.componentStack || "")}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

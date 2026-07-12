import React from "react";
import i18n from "../../i18n/i18n";
import {
  hasChunkReloadAttempted,
  isChunkLoadError,
  recoverFromChunkLoadError,
} from "../utils/chunkLoadRecovery";

function ChunkReloadFallback() {
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-stone-950 px-4 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.06] p-6 text-center shadow-2xl">
        <h1 className="text-2xl font-black">{i18n.t("common.reloadAfterUpdate")}</h1>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 rounded-full bg-white px-5 py-3 text-sm font-black text-stone-950"
        >
          {i18n.t("common.reload")}
        </button>
      </div>
    </div>
  );
}

export default class DebugErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[DebugErrorBoundary] error:", error);
    console.error("[DebugErrorBoundary] componentStack:", info?.componentStack);
    this.setState({ info });
    recoverFromChunkLoadError(error);
  }

  render() {
    const title = this.props.title || "This screen crashed";

    if (this.state.error) {
      if (isChunkLoadError(this.state.error) && hasChunkReloadAttempted()) {
        return <ChunkReloadFallback />;
      }

      return (
        <div className="m-6 rounded-2xl border border-red-500/40 bg-red-950/40 p-6 text-red-100">
          <h1 className="text-xl font-bold">{title}</h1>
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

import React from "react";
import i18n from "../../i18n/i18n";
import {
  hasChunkReloadAttempted,
  isChunkLoadError,
  isChunkRecoveryBlockedOffline,
  recoverFromChunkLoadError,
} from "../utils/chunkLoadRecovery";

// Shown instead of a reload when a screen's code is not on the device and there
// is no connection to fetch it. Nothing was purged, so going back leaves the
// rest of the app -- the POS till above all -- working offline.
function ChunkOfflineFallback({ onBack }) {
  return (
    <div role="alert" className="flex min-h-[50vh] items-center justify-center px-4 py-10 text-[var(--text,#fff)]">
      <div className="flex w-full max-w-md flex-col items-center justify-center gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-6 text-center">
        <h1 className="m1-page-title">
          {i18n.t("common.chunkOffline.title", { defaultValue: "الشاشة دي محتاجة إنترنت" })}
        </h1>
        <p className="text-sm opacity-80">
          {i18n.t("common.chunkOffline.body", {
            defaultValue: "مش متحملة على الجهاز ومفيش اتصال دلوقتي. باقي الشاشات شغالة عادي، والمبيعات بتتحفظ لحد ما النت يرجع.",
          })}
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-2 rounded-full bg-white px-5 py-3 text-sm font-black text-stone-950"
        >
          {i18n.t("common.chunkOffline.back", { defaultValue: "رجوع" })}
        </button>
      </div>
    </div>
  );
}

function ChunkReloadFallback({ showAction = false }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-950 px-4 text-white">
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
    this.state = { error: null, info: null, showChunkAction: false, chunkOffline: false };
    this.chunkActionTimer = null;
    this.unmounted = false;
    this.handleChunkOfflineBack = this.handleChunkOfflineBack.bind(this);
  }

  handleChunkOfflineBack() {
    if (this.chunkActionTimer) window.clearTimeout(this.chunkActionTimer);
    this.setState({ error: null, info: null, showChunkAction: false, chunkOffline: false });
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[DebugErrorBoundary] error:", error);
    console.error("[DebugErrorBoundary] componentStack:", info?.componentStack);
    this.setState({ info });
    if (isChunkLoadError(error)) {
      Promise.resolve(recoverFromChunkLoadError(error))
        .then((recovering) => {
          if (!recovering && isChunkRecoveryBlockedOffline() && !this.unmounted) {
            this.setState({ chunkOffline: true });
          }
        })
        .catch(() => {});
      this.chunkActionTimer = window.setTimeout(() => {
        this.setState({ showChunkAction: true });
      }, 8_000);
    }
  }

  componentWillUnmount() {
    this.unmounted = true;
    if (this.chunkActionTimer) window.clearTimeout(this.chunkActionTimer);
  }

  render() {
    const title = this.props.title || i18n.t(this.props.titleKey || "common.errorBoundary.screenCrashed");

    if (this.state.error) {
      if (isChunkLoadError(this.state.error)) {
        if (this.state.chunkOffline) {
          return <ChunkOfflineFallback onBack={this.handleChunkOfflineBack} />;
        }
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

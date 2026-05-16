import React from "react";

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
  }

  render() {
    const title = this.props.title || "This screen crashed";

    if (this.state.error) {
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

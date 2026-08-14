"use client";

/**
 * Catch failed next/dynamic chunks and child render throws so the hub
 * chrome stays up. Logs to console; presentation owns the fallback UI.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  label?: string;
  onReset?: () => void;
};

type State = { error: Error | null };

export class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const label = this.props.label || "chunk";
    console.error(`[DeptSync] ${label} failed`, error);
    if (info.componentStack) {
      console.error(`[DeptSync] ${label} stack`, info.componentStack);
    }
  }

  private handleRetry = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const label = this.props.label || "This panel";
    return (
      <div className="fixed inset-0 z-[70]" role="alert">
        <div className="absolute inset-0 bg-slate-950/70" />
        <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l-2 border-rose-400/50 bg-slate-950">
          <div className="border-b border-rose-500/30 bg-rose-950/40 px-4 py-3">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-rose-300">
              Load error
            </p>
            <p className="mt-1 text-sm font-bold text-rose-100">{label}</p>
          </div>
          <p className="px-4 pt-4 text-sm text-zinc-300">
            {this.state.error.message || "This panel could not load."}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="mx-4 mt-4 min-h-12 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-slate-950"
          >
            Retry
          </button>
        </aside>
      </div>
    );
  }
}

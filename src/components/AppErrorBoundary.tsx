import { Component, type ErrorInfo, type ReactNode } from "react";
import { recoverStalePage } from "../lib/stalePageRecovery";

type Props = { children: ReactNode };
type State = { error: Error | null; retryCount: number };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retryCount: 0 };
  private retryTimer: number | null = null;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("DEGEN application error", error, info);
    if (recoverStalePage(error)) return;
    if (this.state.retryCount > 0 || this.retryTimer !== null) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.setState((current) => ({
        error: null,
        retryCount: current.retryCount + 1,
      }));
    }, 900);
  }

  componentWillUnmount() {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main role="status" className="route-skeleton">This page is temporarily unavailable. Please try another tab.</main>;
  }
}

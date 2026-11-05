import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Keeps an error inside one part of the app (bug #46): a part that throws while drawing shows
 * `fallback` (nothing by default) and tells `onError`, and everything around it stays on screen.
 * Saving never goes through here: what she wrote is already in the database.
 */
export class ErrorGuard extends Component<
  { children: ReactNode; fallback?: ReactNode; onError?: (e: unknown) => void; name: string; /** After an error, a new value tries again (e.g. she went to another page). Never remounts otherwise. */ resetOn?: unknown },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[${this.props.name}] stopped after an error`, error, info.componentStack);
    this.props.onError?.(error);
  }

  componentDidUpdate(prev: { resetOn?: unknown }): void {
    if (this.state.failed && prev.resetOn !== this.props.resetOn) this.setState({ failed: false });
  }

  render(): ReactNode {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}

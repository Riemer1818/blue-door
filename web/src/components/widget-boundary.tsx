"use client";

import { Component, type ReactNode } from "react";

/**
 * One misbehaving widget must not take the dashboard with it. This matters more
 * once widgets are third-party: an unhandled render error in someone else's code
 * should cost them their card, not the page.
 *
 * It bounds rendering only. It is not a security boundary — in-process widget
 * code can still reach anything this origin can. That is what the iframe is for,
 * later.
 */
export class WidgetBoundary extends Component<
  { children: ReactNode; widgetType: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col justify-center gap-1 p-2 text-sm">
          <span className="font-medium text-red-600 dark:text-red-400">
            {this.props.widgetType} failed to render
          </span>
          <span className="truncate text-xs text-slate-500 dark:text-slate-400" title={this.state.error.message}>
            {this.state.error.message}
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}

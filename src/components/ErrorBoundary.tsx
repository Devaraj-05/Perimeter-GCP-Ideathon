import React from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

/**
 * The last line of defence against a blank page.
 *
 * There was no error boundary anywhere in this application. One render throw
 * anywhere in the tree unmounted everything and left white — which is exactly
 * what happened when an icon import was removed while the component was still
 * rendered: React tried to construct a DOM global, threw "Illegal
 * constructor", and the entire app disappeared with no message at all. The
 * only way to learn anything was to open the console.
 *
 * A boundary cannot prevent that bug. What it can do is make it legible: the
 * user sees that something broke rather than believing their data is gone,
 * and gets a way out that is not "close the tab".
 *
 * INV-10 applies here too. The error message and stack are logged to the
 * console for a developer and are NOT rendered: a React error string can carry
 * component internals and, through a failed render of user content, fragments
 * of that content. The screen gets a sentence we wrote.
 */
interface Props {
  children: React.ReactNode;
  /** Names the region, so a panel crash does not read as a whole-app crash. */
  label?: string;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Console only. This is the one place a stack is useful and the one place
    // it must not be shown.
    console.error('[boundary] render failed:', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <BoundaryFallback label={this.props.label} />;
  }
}

/**
 * The fallback, as its own component.
 *
 * Separated because a boundary cannot be exercised by renderToStaticMarkup —
 * server rendering does not invoke getDerivedStateFromError, so an error in a
 * child propagates instead of being caught, and a test written against the
 * class can only ever assert the happy path. The UI a user actually sees was
 * therefore untestable while it lived inside the class.
 */
export const BoundaryFallback: React.FC<{ label?: string }> = ({ label }) => (
  <div
    role="alert"
    className="flex min-h-[240px] w-full flex-col items-center justify-center gap-3 p-8 text-center"
  >
    <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#e5e5e5] bg-[#fafafa] text-[#1a1a1a]">
      <AlertTriangle className="h-5 w-5" />
    </span>

    <div>
      <p className="font-serif text-base font-semibold text-[#1a1a1a]">
        {label ? `${label} stopped working` : 'Something broke here'}
      </p>
      {/* The reassurance is the point. A white screen reads as data loss, and
          nothing was written — a render failure happens after the save, never
          during one. */}
      <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-[#525252]">
        This is a display problem, not a data one. Nothing you have written was lost, and nothing
        was sent anywhere. Reloading usually clears it.
      </p>
    </div>

    <button
      onClick={() => window.location.reload()}
      className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#1a1a1a] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#000000]"
    >
      <RefreshCw className="h-3.5 w-3.5" />
      Reload
    </button>

    <p className="text-[11px] text-[#6b6b6b]">The details are in your browser console.</p>
  </div>
);

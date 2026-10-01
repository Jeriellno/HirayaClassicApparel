import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';
import { isKnownStartTimeError } from '../../utils/runtimeGuards';

/**
 * App-wide error boundary.
 *
 * A render-phase throw from any child (including a third-party media/WASM
 * callback) would otherwise unmount the whole React tree and leave a blank
 * white screen. This boundary keeps the Hiraya shell on screen and offers a
 * single recovery action.
 *
 * The known, non-fatal `startTime` crash is auto-recovered once instead of
 * being shown to the customer — it comes from the background-removal pipeline
 * and does not represent a broken page.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, recovered: false };
  }

  static getDerivedStateFromError(error) {
    // Silently absorb the known third-party startTime crash on the first hit.
    if (isKnownStartTimeError(error)) {
      return { hasError: false, recovered: true };
    }
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    if (isKnownStartTimeError(error)) {
      console.warn('[Hiraya] Recovered from a non-fatal startTime error:', error?.message);
      return;
    }
    console.error('[Hiraya] Unhandled render error:', error, info?.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      /*
       * THE CRASH SCREEN HAD NO READABLE TEXT AT ALL.
       *
       * The panel was `rounded-3xl border-hiraya-olive/20 bg-hiraya-olive` — an
       * INDIGO slab — while its heading was `text-hiraya-ink` (NAVY) and its body
       * copy `text-hiraya-sand` (ALSO INDIGO). So on the one screen a user only
       * ever sees when something has already gone wrong, the title was
       * navy-on-indigo and the explanation and the body text were literally
       * indigo-on-indigo: measured 1.00:1. There was no message, only a button.
       *
       * It is now the shared raised card on the light canvas, where both inks sit
       * at their designed contrast, and the action is the standard primary plate.
       * The copy and the reload behaviour are unchanged.
       */
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="card-raised w-full max-w-md p-10 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-sm border border-hiraya-accent/30 bg-hiraya-accent-wash text-hiraya-accent">
            <AlertTriangle size={24} />
          </div>
          <h1 className="display-md text-hiraya-ink">
            Something slipped
          </h1>
          <p className="mt-3 text-xs leading-relaxed text-hiraya-ink-soft">
            The Hiraya studio hit an unexpected error. Your bag and profile are safe —
            reload to continue where you left off.
          </p>
          <button
            onClick={this.handleReload}
            className="btn-primary mt-8 w-full cursor-pointer"
          >
            Reload Hiraya
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;

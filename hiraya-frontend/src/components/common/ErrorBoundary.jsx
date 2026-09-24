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
      <div className="min-h-screen flex items-center justify-center bg-black px-6">
        <div className="max-w-md w-full text-center rounded-3xl border-stone-300/30 bg-zinc-950 p-10 shadow-2xl">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E9C46A]/10 border-stone-300/30 text-stone-200">
            <AlertTriangle size={24} />
          </div>
          <h1 className="text-lg font-light uppercase tracking-[0.25em] text-white">
            Something slipped
          </h1>
          <p className="mt-3 text-xs leading-relaxed text-zinc-400">
            The Hiraya studio hit an unexpected error. Your bag and profile are safe —
            reload to continue where you left off.
          </p>
          <button
            onClick={this.handleReload}
            className="mt-8 w-full rounded-xl bg-[#E9C46A] px-6 py-3 text-[10px] font-black uppercase tracking-[0.25em] text-black transition hover:bg-[#D4A94F]"
          >
            Reload Hiraya
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;

import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/global.css';

declare global {
  interface Window {
    __badPhysicsMounted?: boolean;
    __badPhysicsBootError?: (html: string) => void;
  }
}

/** Shows render errors instead of an empty page. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[BAD PHYSICS] render failed', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="error-state" role="alert">
        <p className="eyebrow">SIMULATION FAULT</p>
        <h2>Reality failed to render.</h2>
        <p>{this.state.error.message}</p>
        <button className="btn-primary" onClick={() => location.reload()}>
          RELOAD
        </button>
      </section>
    );
  }
}

window.__badPhysicsMounted = true;
document.getElementById('boot')?.remove();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

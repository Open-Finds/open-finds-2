import { Component, StrictMode } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ThemeProvider } from './components/ThemeProvider';
import { initMonitoring, reportError } from './lib/monitoring';
import { captureSharedLink, listenForInstallPrompt } from './lib/shareTarget';
import './index.css';

// Before render, so a crash during the first paint is still captured.
initMonitoring();
// A link shared into the app (share menu or iPhone Shortcut), kept for Home.
captureSharedLink();
listenForInstallPrompt();

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crashed:', error, info);
    reportError(error, { componentStack: info.componentStack });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-heading text-foreground">Something went wrong.</p>
          <p className="text-sm text-destructive-text">{this.state.error.message}</p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.hash = '#/'; }}
            className="btn-primary"
          >
            Go home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);

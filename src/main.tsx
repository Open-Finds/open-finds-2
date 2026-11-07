import { Component, StrictMode } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ThemeProvider } from './components/ThemeProvider';
import { initMonitoring, reportError } from './lib/monitoring';
import { captureSharedLink, listenForInstallPrompt } from './lib/shareTarget';
import './index.css';
import './theme.css';
import './preview.css';

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

// A real child viewport keeps media queries, fixed controls, dialogs and scrolling
// inside the phone. Production and embedded app renders use the normal app.
const framedPreview = import.meta.env.DEV && ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.self === window.top;
if (framedPreview) {
  document.documentElement.classList.add('phone-preview-host');
  createRoot(document.getElementById('root')!).render(
    <div className="phone-preview-stage">
      <div className="phone-preview-device">
        <iframe className="phone-preview-app" title="The Unsaved iPhone preview" src={window.location.href} allow="geolocation; clipboard-write; web-share" />
      </div>
    </div>
  );
} else {
  // Open the connection to the database while the rest of the app loads. Done
  // here, not as a %VITE_SUPABASE_URL% tag in index.html: that fails the whole
  // build ("URI malformed") wherever the variable isn't set, as on Vercel previews.
  const databaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (databaseUrl) {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = databaseUrl;
    link.crossOrigin = '';
    document.head.appendChild(link);
  }

  // Before render, so a crash during the first paint is still captured.
  initMonitoring();
  // A link shared into the app (share menu or iPhone Shortcut), kept for Home.
  captureSharedLink();
  listenForInstallPrompt();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </ErrorBoundary>
    </StrictMode>
  );
}

import * as Sentry from '@sentry/react';

/**
 * Error tracking.
 *
 * Disabled unless VITE_SENTRY_DSN is set, so local and CI builds stay silent
 * and nothing is reported from a developer's machine by accident.
 *
 * This app handles location, home-adjacent street addresses and the names of
 * guests who never signed up for anything, so the default "send everything"
 * posture is not acceptable. sendDefaultPii stays off and the hooks below strip
 * identifying data before anything leaves the browser.
 */

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const RELEASE = import.meta.env.VITE_APP_VERSION as string | undefined;
const ENVIRONMENT = (import.meta.env.MODE ?? 'development') as string;

/** Query keys whose values are sensitive if they reach an error report. */
const SENSITIVE_QUERY_KEYS = ['rsvp', 'token', 'access_token', 'refresh_token', 'apikey', 'key'];

/** Strips query strings and hash payloads that carry ids or addresses. */
function scrubUrl(raw: string): string {
  try {
    const url = new URL(raw, window.location.origin);
    for (const key of SENSITIVE_QUERY_KEYS) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '[redacted]');
    }
    // Hash routes carry plan and trip ids, which are the share capability.
    url.hash = url.hash.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/[id]');
    return url.toString();
  } catch {
    return raw;
  }
}

export function initMonitoring(): void {
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    environment: ENVIRONMENT,
    // Tagging every event with a release is what makes "this broke in build X"
    // answerable; without it a regression cannot be bisected.
    release: RELEASE,

    // Never attach IP addresses, cookies or user agents automatically.
    sendDefaultPii: false,

    // Performance sampling is off by default; turn it on deliberately once
    // there is a reason to pay for the volume.
    tracesSampleRate: 0,

    beforeSend(event) {
      if (event.request?.url) event.request.url = scrubUrl(event.request.url);
      // The anon key is public, but keeping it out of reports avoids it being
      // mistaken for a leak during triage.
      if (event.request?.headers) {
        delete event.request.headers.Authorization;
        delete event.request.headers.apikey;
      }
      delete event.user?.ip_address;
      delete event.user?.email;
      return event;
    },

    beforeBreadcrumb(crumb) {
      if (crumb.data?.url && typeof crumb.data.url === 'string') {
        crumb.data.url = scrubUrl(crumb.data.url);
      }
      // Console breadcrumbs routinely contain venue names and addresses.
      if (crumb.category === 'console') return null;
      return crumb;
    },
  });
}

/**
 * Associates errors with an account id only — never an email or display name.
 * Call on sign-in, and with null on sign-out.
 */
export function setMonitoringUser(userId: string | null): void {
  if (!DSN) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

/** Reports a handled error that would otherwise be swallowed by a catch. */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!DSN) {
    if (import.meta.env.DEV) console.error('[monitoring]', error, context);
    return;
  }
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export const ErrorBoundary = Sentry.ErrorBoundary;

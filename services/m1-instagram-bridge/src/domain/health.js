export const HEALTH_STATES = Object.freeze(['healthy', 'degraded', 'login_required', 'session_expired', 'selector_failure', 'inbox_unavailable', 'browser_crashed', 'paused']);

export const isOperationalSessionReady = (probe = {}) =>
  probe.session === 'authenticated' && probe.authenticated === true && probe.inboxLoaded === true;

export function mapHealthState(input = {}) {
  // A lost or expired provider session always requires the same operator
  // action: a manual login. Report that actionable state even after the
  // bridge has paused its watchers for safety.
  if (input.loginChallenge || input.loginRequired || input.sessionExpired) return 'login_required';
  if (input.paused) return 'paused';
  if (!input.browserRunning) return input.everStarted ? 'browser_crashed' : 'paused';
  if (input.selectorFailures > 0) return input.selectorFailures >= input.selectorFailureThreshold ? 'selector_failure' : 'degraded';
  if (!input.inboxLoaded) return 'inbox_unavailable';
  return 'healthy';
}

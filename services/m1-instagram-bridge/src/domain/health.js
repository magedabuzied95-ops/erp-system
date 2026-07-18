export const HEALTH_STATES = Object.freeze(['healthy', 'degraded', 'login_required', 'session_expired', 'selector_failure', 'inbox_unavailable', 'browser_crashed', 'paused']);

export function mapHealthState(input = {}) {
  if (input.paused) return 'paused';
  if (!input.browserRunning) return input.everStarted ? 'browser_crashed' : 'paused';
  if (input.loginChallenge || input.loginRequired) return 'login_required';
  if (input.sessionExpired) return 'session_expired';
  if (input.selectorFailures > 0) return input.selectorFailures >= input.selectorFailureThreshold ? 'selector_failure' : 'degraded';
  if (!input.inboxLoaded) return 'inbox_unavailable';
  return 'healthy';
}

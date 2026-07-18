export const RETRY_DELAYS_SECONDS = Object.freeze([30, 60, 120, 300, 600, 1800]);

export function retryDecision(attempts, maxAttempts = 7, now = new Date()) {
  const count = Math.max(0, Number(attempts || 0));
  const allowed = Math.max(1, Number(maxAttempts || 7));
  const delay = RETRY_DELAYS_SECONDS[count - 1];
  if (count >= allowed || delay == null) {
    return { status: 'needs_manual_review', nextRetryAt: null, delaySeconds: null };
  }
  return {
    status: 'retrying',
    delaySeconds: delay,
    nextRetryAt: new Date(now.getTime() + delay * 1000),
  };
}

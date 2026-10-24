import { useEffect } from 'react';

export const shouldResetInboxPrefetch = (event) => event.type === 'erp:auth-expired'
  || (event.type === 'erp:auth-user-updated' && !event.detail?.user);

export default function useInboxPrefetch({ enabled, pathname, identityKey }) {
  useEffect(() => {
    // Clear one-use results on logout, account/tenant changes and permission loss.
    const clear = () => {
      void import('../../modules/aiSupport/services/inboxPrefetch.js').then((m) => m.clearInboxPrefetch());
    };
    const onAuth = (event) => { if (shouldResetInboxPrefetch(event)) clear(); };
    window.addEventListener('erp:auth-user-updated', onAuth);
    window.addEventListener('erp:auth-expired', onAuth);
    if (!enabled) clear();
    return () => {
      window.removeEventListener('erp:auth-user-updated', onAuth);
      window.removeEventListener('erp:auth-expired', onAuth);
      clear();
    };
  }, [enabled, identityKey]);

  useEffect(() => {
    if (!enabled || pathname === '/admin/ai-inbox') return undefined;
    let cancelled = false;
    let idleId;
    const run = async () => {
      if (cancelled || document.hidden || navigator.onLine === false || navigator.connection?.saveData) return;
      const module = await import('../../modules/aiSupport/services/inboxPrefetch.js');
      if (!cancelled) {
        void module.prefetchInbox().catch(() => {});
        // Warm the lazy screen too: ready data alone cannot bypass downloading
        // the inbox UI when the user opens this workspace for the first time.
        void import('../../modules/aiSupport/pages/AiInbox.jsx').catch(() => {});
      }
    };
    // Let the current screen finish its own startup before fetching summaries.
    const timer = window.setTimeout(() => {
      if (window.requestIdleCallback) idleId = window.requestIdleCallback(run, { timeout: 3000 });
      else void run();
    }, 2000);
    const onIntent = (event) => {
      if (event.target.closest?.('a[href="/admin/ai-inbox"]')) void run();
    };
    document.addEventListener('pointerover', onIntent);
    document.addEventListener('focusin', onIntent);
    document.addEventListener('touchstart', onIntent, { passive: true });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idleId !== undefined) window.cancelIdleCallback?.(idleId);
      document.removeEventListener('pointerover', onIntent);
      document.removeEventListener('focusin', onIntent);
      document.removeEventListener('touchstart', onIntent);
    };
  }, [enabled, pathname, identityKey]);
}

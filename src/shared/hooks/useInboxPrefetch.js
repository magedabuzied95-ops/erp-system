import { useEffect } from 'react';

export default function useInboxPrefetch({ enabled, pathname, identityKey }) {
  useEffect(() => {
    // Clear one-use results on logout, account/tenant changes and permission loss.
    const clear = () => {
      void import('../../modules/aiSupport/services/inboxPrefetch.js').then((m) => m.clearInboxPrefetch());
    };
    window.addEventListener('erp:auth-user-updated', clear);
    window.addEventListener('erp:auth-expired', clear);
    if (!enabled) clear();
    return () => {
      window.removeEventListener('erp:auth-user-updated', clear);
      window.removeEventListener('erp:auth-expired', clear);
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
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idleId !== undefined) window.cancelIdleCallback?.(idleId);
    };
  }, [enabled, pathname, identityKey]);
}

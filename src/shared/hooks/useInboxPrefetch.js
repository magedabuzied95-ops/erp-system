import { useEffect } from 'react';

export const shouldResetInboxPrefetch = (event) => event.type === 'erp:auth-expired'
  || (event.type === 'erp:auth-user-updated' && !event.detail?.user);

export default function useInboxPrefetch({ enabled, inboxEnabled = enabled, pathname, identityKey, workspaceRoutes = '' }) {
  useEffect(() => {
    // Clear one-use results on logout, account/tenant changes and permission loss.
    const clear = () => {
      void import('../../modules/aiSupport/services/inboxPrefetch.js').then((m) => m.clearInboxPrefetch());
      void import('../lib/workspacePreload.js').then((m) => m.clearWorkspacePreload());
    };
    const onAuth = (event) => { if (shouldResetInboxPrefetch(event)) clear(); };
    const onProductsChanged = () => {
      void import('../lib/workspacePreload.js').then((m) => { m.invalidateWorkspace('products'); m.invalidateWorkspace('pos'); });
    };
    window.addEventListener('products:refetch', onProductsChanged);
    window.addEventListener('erp:auth-user-updated', onAuth);
    window.addEventListener('erp:auth-expired', onAuth);
    if (!enabled) clear();
    return () => {
      window.removeEventListener('erp:auth-user-updated', onAuth);
      window.removeEventListener('erp:auth-expired', onAuth);
      window.removeEventListener('products:refetch', onProductsChanged);
      clear();
    };
  }, [enabled, identityKey, workspaceRoutes]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let idleId;
    const run = async (intent) => {
      if (cancelled || document.hidden || navigator.onLine === false || navigator.connection?.saveData) return;
      if (inboxEnabled && pathname !== '/admin/ai-inbox') {
        const module = await import('../../modules/aiSupport/services/inboxPrefetch.js');
        if (cancelled) return;
        const ready = module.prefetchInbox().catch(() => {});
        // Warm the lazy screen too: ready data alone cannot bypass downloading
        // the inbox UI when the user opens this workspace for the first time.
        void import('../../modules/aiSupport/pages/AiInbox.jsx').catch(() => {});
        await ready;
      }
      if (cancelled) return;
      const workspace = await import('../lib/workspacePreload.js');
      if (!cancelled) await workspace.preloadWorkspaces({ routes: workspaceRoutes.split(','), pathname, cancelled: () => cancelled, intent });
    };
    // Let the current screen finish its own startup before fetching summaries.
    const timer = window.setTimeout(() => {
      if (window.requestIdleCallback) idleId = window.requestIdleCallback(() => { void run().catch(() => {}); }, { timeout: 3000 });
      else void run().catch(() => {});
    }, 2000);
    const onIntent = (event) => {
      const href = event.target.closest?.('a[href]')?.getAttribute('href');
      if (href === '/admin/ai-inbox' || workspaceRoutes.split(',').includes(href)) void run(href).catch(() => {});
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
  }, [enabled, inboxEnabled, pathname, identityKey, workspaceRoutes]);
}

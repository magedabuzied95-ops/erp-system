import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { featureFlagService } from "./aiFeatureFlags";
import { runtimeConfigService } from "./RuntimeConfigService";

const FeatureFlagContext = createContext(featureFlagService);

export function FeatureFlagProvider({ children, poll = true }) {
  useEffect(() => {
    const apply = (config) => featureFlagService.setRuntimeConfig(config.featureFlags || config);
    // Always seed context with the current/default flags so consumers render.
    apply(runtimeConfigService.getSnapshot());
    // The customer storefront consumes no feature flags, so skip the recurring
    // no-store /runtime-config.json poll there (it otherwise fetches every 5s).
    if (!poll) return undefined;
    const unsubscribe = runtimeConfigService.subscribe(apply);
    runtimeConfigService.start();
    return () => { unsubscribe(); runtimeConfigService.stop(); };
  }, [poll]);
  return <FeatureFlagContext.Provider value={featureFlagService}>{children}</FeatureFlagContext.Provider>;
}

export function useFeatureFlags() {
  const service = useContext(FeatureFlagContext);
  return useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
}

export function useFeatureFlag(name) {
  return useFeatureFlags()[name] ?? false;
}

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { featureFlagService } from "./aiFeatureFlags";
import { runtimeConfigService } from "./RuntimeConfigService";

const FeatureFlagContext = createContext(featureFlagService);

export function FeatureFlagProvider({ children }) {
  useEffect(() => {
    const apply = (config) => featureFlagService.setRuntimeConfig(config.featureFlags || config);
    apply(runtimeConfigService.getSnapshot());
    const unsubscribe = runtimeConfigService.subscribe(apply);
    runtimeConfigService.start();
    return () => { unsubscribe(); runtimeConfigService.stop(); };
  }, []);
  return <FeatureFlagContext.Provider value={featureFlagService}>{children}</FeatureFlagContext.Provider>;
}

export function useFeatureFlags() {
  const service = useContext(FeatureFlagContext);
  return useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
}

export function useFeatureFlag(name) {
  return useFeatureFlags()[name] ?? false;
}

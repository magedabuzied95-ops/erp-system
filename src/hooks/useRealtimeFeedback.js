import { useCallback, useEffect, useState } from "react";

import {
  emitRealtimeFeedback,
  getRealtimeFeedbackSettings,
  initRealtimeFeedback,
  playRealtimeSound,
  requestBrowserNotificationPermission,
  saveRealtimeFeedbackSettings,
  subscribeRealtimeFeedbackSettings,
  unlockRealtimeFeedbackAudio,
} from "../services/realtimeFeedbackService";

export function useRealtimeFeedback() {
  const [settings, setSettings] = useState(() => getRealtimeFeedbackSettings());

  useEffect(() => {
    initRealtimeFeedback();
    return subscribeRealtimeFeedbackSettings((next) => setSettings(next));
  }, []);

  const updateSettings = useCallback((patch) => {
    setSettings(saveRealtimeFeedbackSettings(patch));
  }, []);

  const testSound = useCallback(async (sound = "notification") => {
    await unlockRealtimeFeedbackAudio();
    return playRealtimeSound(sound, { priority: "high", key: `test-${sound}` });
  }, []);

  const emitFeedback = useCallback((eventName, payload = {}, options = {}) => emitRealtimeFeedback(eventName, payload, options), []);

  return {
    settings,
    updateSettings,
    testSound,
    emitFeedback,
    unlock: unlockRealtimeFeedbackAudio,
    requestBrowserNotificationPermission,
  };
}

export default useRealtimeFeedback;

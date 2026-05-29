import { useEffect } from "react";

import { initRealtimeFeedback } from "../../services/realtimeFeedbackService";
import RealtimeToastManager from "./RealtimeToastManager";

export function NotificationSoundProvider({ children }) {
  useEffect(() => {
    initRealtimeFeedback();
  }, []);

  return (
    <>
      <RealtimeToastManager />
      {children}
    </>
  );
}

export default NotificationSoundProvider;

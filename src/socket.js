import { io }
from "socket.io-client";

import { SOCKET_URL }
from "./shared/constants/app";

const isSocketDebugEnabled = () => {
  if (typeof window === "undefined") return false;
  try {
    return import.meta.env.DEV || window.localStorage.getItem("SOCKET_DEBUG") === "1";
  } catch {
    return Boolean(import.meta.env.DEV);
  }
};

export const socket =
  io(
    SOCKET_URL,
    {
      autoConnect: false,
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 8000,
      randomizationFactor: 0.5,
      transports: ["websocket", "polling"],
    }
  );

socket.on("connect", () => {
  if (isSocketDebugEnabled()) console.debug("[socket] connect", { url: SOCKET_URL });
});
socket.on("connect_error", (error) => {
  if (isSocketDebugEnabled()) console.debug("[socket] connect_error", error?.message || error);
});
socket.on("error", (error) => {
  if (isSocketDebugEnabled()) console.debug("[socket] error", error?.message || error);
});

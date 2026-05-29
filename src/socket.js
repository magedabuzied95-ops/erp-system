import { io }
from "socket.io-client";

import { SOCKET_URL }
from "./shared/constants/app";

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

socket.on("connect_error", () => {});
socket.on("error", () => {});

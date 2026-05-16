import { io }
from "socket.io-client";

import { SOCKET_URL }
from "./shared/constants/app";

export const socket =
  io(
    SOCKET_URL,
    {
      autoConnect: true,
      reconnection: false,
      transports: ["websocket", "polling"],
    }
  );

socket.on("connect_error", () => {});
socket.on("error", () => {});

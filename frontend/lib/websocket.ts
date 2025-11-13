import { io, Socket } from "socket.io-client";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "http://localhost:4000";

let socket: Socket | null = null;

export function initializeWebSocket(userId: string): Socket {
  if (socket?.connected) {
    return socket;
  }

  socket = io(WS_URL, {
    auth: {
      userId,
    },
    transports: ["websocket"],
  });

  socket.on("connect", () => {
    console.log("WebSocket connected");
  });

  socket.on("disconnect", () => {
    console.log("WebSocket disconnected");
  });

  return socket;
}

export function disconnectWebSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket(): Socket | null {
  return socket;
}

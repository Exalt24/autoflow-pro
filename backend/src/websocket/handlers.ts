import type { AuthenticatedSocket, WebSocketServer } from "./index.js";

export function setupHandlers(
  socket: AuthenticatedSocket,
  wsServer: WebSocketServer
) {
  socket.on("subscribe:execution", (data: { executionId: string }) => {
    if (!data.executionId) {
      socket.emit("error", { message: "executionId is required" });
      return;
    }

    const room = `execution:${data.executionId}`;
    socket.join(room);
    console.log(
      `✓ Socket ${socket.id} subscribed to execution ${data.executionId}`
    );

    socket.emit("subscribed", {
      room,
      executionId: data.executionId,
    });
  });

  socket.on("unsubscribe:execution", (data: { executionId: string }) => {
    if (!data.executionId) {
      socket.emit("error", { message: "executionId is required" });
      return;
    }

    const room = `execution:${data.executionId}`;
    socket.leave(room);
    console.log(
      `✓ Socket ${socket.id} unsubscribed from execution ${data.executionId}`
    );

    socket.emit("unsubscribed", {
      room,
      executionId: data.executionId,
    });
  });

  socket.on("ping", () => {
    socket.emit("pong", { timestamp: new Date().toISOString() });
  });

  socket.on("get:connections", () => {
    socket.emit("connections", {
      count: wsServer.getConnectionCount(),
    });
  });
}

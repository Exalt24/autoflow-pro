import { io, Socket } from "socket.io-client";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "http://localhost:4000";

let socket: Socket | null = null;
let hasLoggedWarning = false;

export interface ExecutionStatusUpdate {
  executionId: string;
  status: "queued" | "running" | "completed" | "failed";
  progress?: number;
}

export interface ExecutionLogUpdate {
  executionId: string;
  log: {
    timestamp: string;
    level: "info" | "warn" | "error";
    message: string;
    step_id?: string;
  };
}

export interface ExecutionCompleted {
  executionId: string;
  data: Record<string, unknown>;
}

export interface ExecutionFailed {
  executionId: string;
  error: string;
}

export const initializeWebSocket = (token: string): Socket => {
  if (socket?.connected) {
    return socket;
  }

  socket = io(WS_URL, {
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 3,
    autoConnect: false,
  });

  socket.on("connect", () => {
    console.log("✓ WebSocket connected");
    hasLoggedWarning = false;
  });

  socket.on("disconnect", (reason) => {
    if (reason !== "io client disconnect") {
      console.log("WebSocket disconnected:", reason);
    }
  });

  socket.on("connect_error", () => {
    if (!hasLoggedWarning) {
      console.warn("WebSocket unavailable - real-time features disabled");
      hasLoggedWarning = true;
    }
  });

  // Attempt connection but don't block if it fails
  try {
    socket.connect();
  } catch {
    console.warn("Failed to initialize WebSocket");
  }

  return socket;
};

export const disconnectWebSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
    hasLoggedWarning = false;
  }
};

export const subscribeToExecution = (
  executionId: string,
  handlers: {
    onStatus?: (data: ExecutionStatusUpdate) => void;
    onLog?: (data: ExecutionLogUpdate) => void;
    onCompleted?: (data: ExecutionCompleted) => void;
    onFailed?: (data: ExecutionFailed) => void;
  }
): (() => void) => {
  if (!socket) {
    console.warn("WebSocket not initialized");
    return () => {};
  }

  socket.emit("subscribe:execution", { executionId });

  if (handlers.onStatus) {
    socket.on("execution:status", handlers.onStatus);
  }
  if (handlers.onLog) {
    socket.on("execution:log", handlers.onLog);
  }
  if (handlers.onCompleted) {
    socket.on("execution:completed", handlers.onCompleted);
  }
  if (handlers.onFailed) {
    socket.on("execution:failed", handlers.onFailed);
  }

  return () => {
    if (!socket) return;

    socket.emit("unsubscribe:execution", { executionId });
    if (handlers.onStatus) socket.off("execution:status", handlers.onStatus);
    if (handlers.onLog) socket.off("execution:log", handlers.onLog);
    if (handlers.onCompleted)
      socket.off("execution:completed", handlers.onCompleted);
    if (handlers.onFailed) socket.off("execution:failed", handlers.onFailed);
  };
};

export const getSocket = (): Socket | null => socket;

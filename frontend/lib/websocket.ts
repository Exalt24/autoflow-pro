import { io, Socket } from "socket.io-client";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "http://localhost:4000";

let socket: Socket | null = null;
let hasLoggedWarning = false;
let reconnectAttempts = 0;

export interface ExecutionStatusUpdate {
  executionId: string;
  status: "queued" | "running" | "completed" | "failed";
  progress?: number;
  estimatedTimeRemaining?: number;
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

export interface ExecutionLogsBatch {
  executionId: string;
  logs: Array<{
    timestamp: string;
    level: string;
    message: string;
    step_id?: string;
  }>;
  count: number;
}

export interface ExecutionCompleted {
  executionId: string;
  status: string;
  duration?: number;
  extractedData?: Record<string, unknown>;
}

export interface ExecutionFailed {
  executionId: string;
  status: string;
  error: string;
}

function getReconnectionDelay(attemptNumber: number): number {
  const baseDelay = 1000;
  const maxDelay = 30000;
  const delay = Math.min(baseDelay * Math.pow(2, attemptNumber), maxDelay);
  const jitter = Math.random() * 1000;
  return delay + jitter;
}

export const initializeWebSocket = (token: string): Socket => {
  if (socket?.connected) {
    return socket;
  }

  socket = io(WS_URL, {
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    reconnectionAttempts: Infinity,
    autoConnect: false,
  });

  socket.on("connect", () => {
    console.log("✓ WebSocket connected");
    hasLoggedWarning = false;
    reconnectAttempts = 0;
  });

  socket.on("disconnect", (reason) => {
    if (reason !== "io client disconnect") {
      console.log("WebSocket disconnected:", reason);
    }
  });

  socket.io.on("reconnect_attempt", (attempt) => {
    reconnectAttempts = attempt;
    const delay = getReconnectionDelay(attempt - 1);
    console.log(
      `WebSocket reconnection attempt ${attempt} (next delay: ${Math.round(
        delay / 1000
      )}s)`
    );
  });

  socket.io.on("reconnect", (attemptNumber) => {
    console.log(`✓ WebSocket reconnected after ${attemptNumber} attempts`);
    reconnectAttempts = 0;
  });

  socket.io.on("reconnect_failed", () => {
    console.error("✗ WebSocket reconnection failed after maximum attempts");
  });

  socket.on("connect_error", () => {
    if (!hasLoggedWarning) {
      console.warn("WebSocket unavailable - real-time features disabled");
      hasLoggedWarning = true;
    }
  });

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
    reconnectAttempts = 0;
  }
};

export const subscribeToExecution = (
  executionId: string,
  handlers: {
    onStatus?: (data: ExecutionStatusUpdate) => void;
    onLog?: (data: ExecutionLogUpdate) => void;
    onLogsBatch?: (data: ExecutionLogsBatch) => void;
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

  if (handlers.onLogsBatch) {
    socket.on("execution:logs:batch", handlers.onLogsBatch);
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
    if (handlers.onLogsBatch)
      socket.off("execution:logs:batch", handlers.onLogsBatch);
    if (handlers.onCompleted)
      socket.off("execution:completed", handlers.onCompleted);
    if (handlers.onFailed) socket.off("execution:failed", handlers.onFailed);
  };
};

export const getSocket = (): Socket | null => socket;

export const getConnectionStatus = () => ({
  connected: socket?.connected ?? false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reconnecting: (socket?.io as any)?._reconnecting ?? false,
  reconnectAttempts,
});

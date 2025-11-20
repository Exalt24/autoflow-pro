import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "http";
import { verifyToken } from "../config/auth.js";
import { setupHandlers } from "./handlers.js";

export interface AuthenticatedSocket {
  id: string;
  userId: string;
  email: string;
  join: (room: string) => void;
  leave: (room: string) => void;
  emit: (event: string, ...args: any[]) => void;
  on: (event: string, handler: (...args: any[]) => void) => void;
  disconnect: () => void;
}

interface QueuedMessage {
  room: string;
  event: string;
  data: any;
  timestamp: number;
}

interface BatchedLogs {
  [executionId: string]: Array<{
    timestamp: string;
    level: string;
    message: string;
    step_id?: string;
  }>;
}

export class WebSocketServer {
  private io: SocketIOServer;
  private connections = new Map<string, AuthenticatedSocket>();
  private messageQueue: QueuedMessage[] = [];
  private batchedLogs: BatchedLogs = {};
  private lastActivityMap = new Map<string, number>();
  private throttleInterval: NodeJS.Timeout | null = null;
  private batchInterval: NodeJS.Timeout | null = null;
  private idleCheckInterval: NodeJS.Timeout | null = null;

  private readonly MAX_MESSAGES_PER_SECOND = 10;
  private readonly BATCH_INTERVAL_MS = 1000;
  private readonly IDLE_TIMEOUT_MS = 30 * 60 * 1000;

  constructor(httpServer: HTTPServer, corsOrigin: string) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: corsOrigin,
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    this.setupMiddleware();
    this.setupConnectionHandlers();
    this.startThrottleProcessor();
    this.startBatchProcessor();
    this.startIdleConnectionChecker();
  }

  private setupMiddleware() {
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error("Authentication token required"));
        }

        const user = await verifyToken(token);
        if (!user) {
          return next(new Error("Invalid or expired token"));
        }

        (socket as any).userId = user.id;
        (socket as any).userEmail = user.email;
        next();
      } catch (error) {
        next(new Error("Authentication failed"));
      }
    });
  }

  private setupConnectionHandlers() {
    this.io.on("connection", (socket) => {
      const userId = (socket as any).userId;
      const userEmail = (socket as any).userEmail;

      console.log(`✓ WebSocket client connected: ${socket.id} (${userEmail})`);

      const authenticatedSocket: AuthenticatedSocket = {
        id: socket.id,
        userId,
        email: userEmail,
        join: (room: string) => socket.join(room),
        leave: (room: string) => socket.leave(room),
        emit: (event: string, ...args: any[]) => socket.emit(event, ...args),
        on: (event: string, handler: (...args: any[]) => void) =>
          socket.on(event, handler),
        disconnect: () => socket.disconnect(),
      };

      this.connections.set(socket.id, authenticatedSocket);
      this.lastActivityMap.set(socket.id, Date.now());
      socket.join(`user:${userId}`);

      setupHandlers(authenticatedSocket, this);

      socket.onAny(() => {
        this.lastActivityMap.set(socket.id, Date.now());
      });

      socket.on("disconnect", () => {
        console.log(`✓ WebSocket client disconnected: ${socket.id}`);
        this.connections.delete(socket.id);
        this.lastActivityMap.delete(socket.id);
      });
    });
  }

  private startThrottleProcessor() {
    const intervalMs = Math.ceil(1000 / this.MAX_MESSAGES_PER_SECOND);

    this.throttleInterval = setInterval(() => {
      if (this.messageQueue.length === 0) return;

      const message = this.messageQueue.shift();
      if (message) {
        this.io.to(message.room).emit(message.event, message.data);
      }
    }, intervalMs);
  }

  private startBatchProcessor() {
    this.batchInterval = setInterval(() => {
      if (Object.keys(this.batchedLogs).length === 0) return;

      for (const [executionId, logs] of Object.entries(this.batchedLogs)) {
        if (logs.length > 0) {
          this.queueMessage(
            `execution:${executionId}`,
            "execution:logs:batch",
            {
              executionId,
              logs,
              count: logs.length,
            }
          );
        }
      }

      this.batchedLogs = {};
    }, this.BATCH_INTERVAL_MS);
  }

  private startIdleConnectionChecker() {
    this.idleCheckInterval = setInterval(() => {
      const now = Date.now();

      for (const [socketId, lastActivity] of this.lastActivityMap.entries()) {
        if (now - lastActivity > this.IDLE_TIMEOUT_MS) {
          const socket = this.connections.get(socketId);
          if (socket) {
            console.log(
              `✓ Disconnecting idle connection: ${socketId} (${socket.email})`
            );
            socket.disconnect();
            this.connections.delete(socketId);
            this.lastActivityMap.delete(socketId);
          }
        }
      }
    }, 60000);
  }

  private queueMessage(room: string, event: string, data: any) {
    this.messageQueue.push({
      room,
      event,
      data,
      timestamp: Date.now(),
    });
  }

  broadcastToUser(userId: string, event: string, data: any) {
    this.queueMessage(`user:${userId}`, event, data);
  }

  broadcastToExecution(executionId: string, event: string, data: any) {
    this.queueMessage(`execution:${executionId}`, event, data);
  }

  broadcastLogToExecution(
    executionId: string,
    log: {
      timestamp: string;
      level: string;
      message: string;
      step_id?: string;
    }
  ) {
    if (!this.batchedLogs[executionId]) {
      this.batchedLogs[executionId] = [];
    }
    this.batchedLogs[executionId].push(log);
  }

  broadcastToAll(event: string, data: any) {
    this.queueMessage("*", event, data);
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  getQueueStats() {
    return {
      queuedMessages: this.messageQueue.length,
      batchedLogs: Object.values(this.batchedLogs).reduce(
        (sum, logs) => sum + logs.length,
        0
      ),
      activeConnections: this.connections.size,
      maxMessagesPerSecond: this.MAX_MESSAGES_PER_SECOND,
    };
  }

  getIO(): SocketIOServer {
    return this.io;
  }

  async close() {
    if (this.throttleInterval) clearInterval(this.throttleInterval);
    if (this.batchInterval) clearInterval(this.batchInterval);
    if (this.idleCheckInterval) clearInterval(this.idleCheckInterval);

    await this.io.close();
  }
}

export let wsServer: WebSocketServer | null = null;

export function initializeWebSocket(
  httpServer: HTTPServer,
  corsOrigin: string
): WebSocketServer {
  wsServer = new WebSocketServer(httpServer, corsOrigin);
  return wsServer;
}

export function getWebSocketServer(): WebSocketServer {
  if (!wsServer) {
    throw new Error("WebSocket server not initialized");
  }
  return wsServer;
}

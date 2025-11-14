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

export class WebSocketServer {
  private io: SocketIOServer;
  private connections = new Map<string, AuthenticatedSocket>();

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

      socket.join(`user:${userId}`);

      setupHandlers(authenticatedSocket, this);

      socket.on("disconnect", () => {
        console.log(`✓ WebSocket client disconnected: ${socket.id}`);
        this.connections.delete(socket.id);
      });
    });
  }

  broadcastToUser(userId: string, event: string, data: any) {
    this.io.to(`user:${userId}`).emit(event, data);
  }

  broadcastToExecution(executionId: string, event: string, data: any) {
    this.io.to(`execution:${executionId}`).emit(event, data);
  }

  broadcastToAll(event: string, data: any) {
    this.io.emit(event, data);
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  getIO(): SocketIOServer {
    return this.io;
  }

  async close() {
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

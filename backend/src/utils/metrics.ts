import { queueService } from "../services/QueueService.js";
import { supabase } from "../config/supabase.js";

export interface SystemMetrics {
  uptime: number;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  queue: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  database: {
    connected: boolean;
    responseTime?: number;
  };
  redis: {
    connected: boolean;
    commandsPerMinute: number;
  };
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const uptime = process.uptime();
  const memUsed = process.memoryUsage().heapUsed;
  const memTotal = process.memoryUsage().heapTotal;

  const queueMetrics = await queueService.getQueueMetrics();
  const redisStats = queueService.getRedisStats();

  let dbConnected = false;
  let dbResponseTime: number | undefined;

  try {
    const start = Date.now();
    await supabase.from("workflows").select("id").limit(1);
    dbResponseTime = Date.now() - start;
    dbConnected = true;
  } catch {
    dbConnected = false;
  }

  return {
    uptime,
    memory: {
      used: memUsed,
      total: memTotal,
      percentage: (memUsed / memTotal) * 100,
    },
    queue: queueMetrics,
    database: {
      connected: dbConnected,
      responseTime: dbResponseTime,
    },
    redis: {
      connected: true,
      commandsPerMinute: redisStats.commandsPerMinute,
    },
  };
}

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  checks: {
    database: { status: "pass" | "fail"; responseTime?: number };
    queue: { status: "pass" | "fail"; active: number; waiting: number };
    redis: { status: "pass" | "fail"; commandsPerMinute: number };
    memory: { status: "pass" | "warn" | "fail"; percentage: number };
  };
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const metrics = await getSystemMetrics();

  const dbStatus = metrics.database.connected ? "pass" : "fail";
  const queueStatus =
    metrics.queue.active >= 0 && metrics.queue.waiting >= 0 ? "pass" : "fail";
  const redisStatus = metrics.redis.connected ? "pass" : "fail";

  let memoryStatus: "pass" | "warn" | "fail" = "pass";
  if (metrics.memory.percentage > 95) memoryStatus = "fail";
  else if (metrics.memory.percentage > 85) memoryStatus = "warn";

  const allPass =
    dbStatus === "pass" &&
    queueStatus === "pass" &&
    redisStatus === "pass" &&
    memoryStatus === "pass";
  const anyFail =
    dbStatus === "fail" ||
    queueStatus === "fail" ||
    redisStatus === "fail";

  let status: "healthy" | "degraded" | "unhealthy" = "healthy";
  if (anyFail) status = "unhealthy";
  else if (!allPass) status = "degraded";

  return {
    status,
    timestamp: new Date().toISOString(),
    uptime: metrics.uptime,
    checks: {
      database: {
        status: dbStatus,
        responseTime: metrics.database.responseTime,
      },
      queue: {
        status: queueStatus,
        active: metrics.queue.active,
        waiting: metrics.queue.waiting,
      },
      redis: {
        status: redisStatus,
        commandsPerMinute: metrics.redis.commandsPerMinute,
      },
      memory: {
        status: memoryStatus,
        percentage: Math.round(metrics.memory.percentage),
      },
    },
  };
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.length > 0 ? parts.join(" ") : "< 1m";
}

export function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(2)} MB`;
}

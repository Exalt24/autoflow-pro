import { supabase } from "./supabase.js";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface RealtimeSubscriptionConfig {
  table: "executions" | "execution_logs";
  filter?: string;
  onInsert?: (payload: any) => void;
  onUpdate?: (payload: any) => void;
  onDelete?: (payload: any) => void;
}

export class RealtimeService {
  private channels: Map<string, RealtimeChannel> = new Map();

  subscribe(config: RealtimeSubscriptionConfig): RealtimeChannel {
    const channelName = `${config.table}_${config.filter || "all"}`;

    if (this.channels.has(channelName)) {
      return this.channels.get(channelName)!;
    }

    let channel = supabase.channel(channelName);

    if (config.filter) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: config.table,
          filter: config.filter,
        },
        (payload) => {
          if (payload.eventType === "INSERT" && config.onInsert) {
            config.onInsert(payload.new);
          } else if (payload.eventType === "UPDATE" && config.onUpdate) {
            config.onUpdate(payload.new);
          } else if (payload.eventType === "DELETE" && config.onDelete) {
            config.onDelete(payload.old);
          }
        }
      );
    } else {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: config.table,
        },
        (payload) => {
          if (payload.eventType === "INSERT" && config.onInsert) {
            config.onInsert(payload.new);
          } else if (payload.eventType === "UPDATE" && config.onUpdate) {
            config.onUpdate(payload.new);
          } else if (payload.eventType === "DELETE" && config.onDelete) {
            config.onDelete(payload.old);
          }
        }
      );
    }

    channel.subscribe((status) => {
      console.log(`[Realtime] Channel ${channelName} status:`, status);
    });

    this.channels.set(channelName, channel);
    return channel;
  }

  unsubscribe(channelName: string): void {
    const channel = this.channels.get(channelName);
    if (channel) {
      supabase.removeChannel(channel);
      this.channels.delete(channelName);
      console.log(`[Realtime] Unsubscribed from ${channelName}`);
    }
  }

  unsubscribeAll(): void {
    this.channels.forEach((channel, name) => {
      supabase.removeChannel(channel);
      console.log(`[Realtime] Unsubscribed from ${name}`);
    });
    this.channels.clear();
  }

  subscribeToExecution(
    executionId: string,
    callbacks: {
      onUpdate?: (execution: any) => void;
    }
  ): RealtimeChannel {
    return this.subscribe({
      table: "executions",
      filter: `id=eq.${executionId}`,
      onUpdate: callbacks.onUpdate,
    });
  }

  subscribeToExecutionLogs(
    executionId: string,
    callbacks: {
      onInsert?: (log: any) => void;
    }
  ): RealtimeChannel {
    return this.subscribe({
      table: "execution_logs",
      filter: `execution_id=eq.${executionId}`,
      onInsert: callbacks.onInsert,
    });
  }

  subscribeToUserExecutions(
    userId: string,
    callbacks: {
      onInsert?: (execution: any) => void;
      onUpdate?: (execution: any) => void;
    }
  ): RealtimeChannel {
    return this.subscribe({
      table: "executions",
      filter: `user_id=eq.${userId}`,
      onInsert: callbacks.onInsert,
      onUpdate: callbacks.onUpdate,
    });
  }
}

export const realtimeService = new RealtimeService();

export async function testRealtimeConnection(): Promise<boolean> {
  try {
    const testChannel = supabase
      .channel("test_connection")
      .on("presence", { event: "sync" }, () => {
        console.log("[Realtime] Test connection successful");
      })
      .subscribe();

    await new Promise((resolve) => setTimeout(resolve, 2000));

    supabase.removeChannel(testChannel);
    return true;
  } catch (error) {
    console.error("[Realtime] Connection test failed:", error);
    return false;
  }
}

import { supabase } from "./supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Database } from "@/types";

type ExecutionRow = Database["public"]["Tables"]["executions"]["Row"];
type ExecutionLogRow = Database["public"]["Tables"]["execution_logs"]["Row"];

export interface RealtimeSubscriptionConfig {
  table: "executions" | "execution_logs";
  filter?: string;
  onInsert?: (payload: ExecutionRow | ExecutionLogRow) => void;
  onUpdate?: (payload: ExecutionRow | ExecutionLogRow) => void;
  onDelete?: (payload: ExecutionRow | ExecutionLogRow) => void;
}

export class RealtimeClient {
  private channels: Map<string, RealtimeChannel> = new Map();

  subscribe(config: RealtimeSubscriptionConfig): RealtimeChannel {
    const channelName = `${config.table}_${
      config.filter || "all"
    }_${Date.now()}`;

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
            config.onInsert(payload.new as ExecutionRow | ExecutionLogRow);
          } else if (payload.eventType === "UPDATE" && config.onUpdate) {
            config.onUpdate(payload.new as ExecutionRow | ExecutionLogRow);
          } else if (payload.eventType === "DELETE" && config.onDelete) {
            config.onDelete(payload.old as ExecutionRow | ExecutionLogRow);
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
            config.onInsert(payload.new as ExecutionRow | ExecutionLogRow);
          } else if (payload.eventType === "UPDATE" && config.onUpdate) {
            config.onUpdate(payload.new as ExecutionRow | ExecutionLogRow);
          } else if (payload.eventType === "DELETE" && config.onDelete) {
            config.onDelete(payload.old as ExecutionRow | ExecutionLogRow);
          }
        }
      );
    }

    channel.subscribe();
    this.channels.set(channelName, channel);
    return channel;
  }

  unsubscribe(channel: RealtimeChannel): void {
    supabase.removeChannel(channel);
    this.channels.forEach((ch, name) => {
      if (ch === channel) {
        this.channels.delete(name);
      }
    });
  }

  unsubscribeAll(): void {
    this.channels.forEach((channel) => {
      supabase.removeChannel(channel);
    });
    this.channels.clear();
  }
}

export const realtimeClient = new RealtimeClient();

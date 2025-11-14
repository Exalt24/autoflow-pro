import { useEffect, useState } from "react";
import { realtimeClient } from "@/lib/realtime";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface LogEntry {
  id: string;
  execution_id: string;
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  step_id?: string;
  metadata?: Record<string, unknown>;
}

export function useLogSubscription(executionId: string | null) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    if (!executionId) {
      return;
    }

    let channel: RealtimeChannel | null = null;

    const subscribe = () => {
      channel = realtimeClient.subscribe({
        table: "execution_logs",
        filter: `execution_id=eq.${executionId}`,
        onInsert: (payload) => {
          setLogs((prev) => [...prev, payload as LogEntry]);
        },
      });
      setIsSubscribed(true);
    };

    subscribe();

    return () => {
      if (channel) {
        realtimeClient.unsubscribe(channel);
      }
      setIsSubscribed(false);
      setLogs([]);
    };
  }, [executionId]);

  const clearLogs = () => {
    setLogs([]);
  };

  return { logs, isSubscribed, clearLogs };
}

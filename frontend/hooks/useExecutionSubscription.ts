import { useEffect, useState } from "react";
import { realtimeClient } from "@/lib/realtime";
import type { Execution } from "@/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

export function useExecutionSubscription(executionId: string | null) {
  const [execution, setExecution] = useState<Execution | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    if (!executionId) {
      return;
    }

    let channel: RealtimeChannel | null = null;

    const subscribe = () => {
      channel = realtimeClient.subscribe({
        table: "executions",
        filter: `id=eq.${executionId}`,
        onUpdate: (payload) => {
          setExecution(payload as Execution);
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
    };
  }, [executionId]);

  return { execution, isSubscribed };
}

export function useUserExecutionsSubscription(userId: string | null) {
  const [newExecution, setNewExecution] = useState<Execution | null>(null);
  const [updatedExecution, setUpdatedExecution] = useState<Execution | null>(
    null
  );
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    if (!userId) {
      return;
    }

    let channel: RealtimeChannel | null = null;

    const subscribe = () => {
      channel = realtimeClient.subscribe({
        table: "executions",
        filter: `user_id=eq.${userId}`,
        onInsert: (payload) => {
          setNewExecution(payload as Execution);
        },
        onUpdate: (payload) => {
          setUpdatedExecution(payload as Execution);
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
    };
  }, [userId]);

  return { newExecution, updatedExecution, isSubscribed };
}

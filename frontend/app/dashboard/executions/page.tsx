"use client";

import { useState, useEffect, useCallback } from "react";
import { ExecutionList } from "@/components/execution/ExecutionList";
import { executionsApi, Execution } from "@/lib/api";

export default function ExecutionsPage() {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [total, setTotal] = useState(0);
  const [page] = useState(1);
  const [loading, setLoading] = useState(true);

  const fetchExecutions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await executionsApi.list({ page, limit: 10 });
      setExecutions(result.executions);
      setTotal(result.total);
    } catch (error) {
      console.error("Failed to fetch executions:", error);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchExecutions();
  }, [fetchExecutions]);

  if (loading) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Executions</h1>
          <p className="text-gray-600">
            View and manage workflow execution history
          </p>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 bg-gray-200 animate-pulse rounded-lg"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Executions</h1>
        <p className="text-gray-600">
          View and manage workflow execution history
        </p>
      </div>
      <ExecutionList
        initialExecutions={executions}
        initialTotal={total}
        initialPage={page}
        initialLimit={10}
      />
    </div>
  );
}

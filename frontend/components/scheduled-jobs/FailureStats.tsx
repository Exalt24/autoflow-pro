"use client";

import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, AlertCircle, CheckCircle } from "lucide-react";
import { scheduledJobsApi } from "@/lib/api";

interface FailureStatsProps {
  jobId: string;
}

interface Stats {
  consecutiveFailures: number;
  lastFailureAt: string | null;
  recentFailureRate: number;
  totalRecentExecutions: number;
  isPaused: boolean;
}

export function FailureStats({ jobId }: FailureStatsProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const data = await scheduledJobsApi.getStats(jobId);
      setStats(data);
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="border border-gray-200 rounded-lg p-6">
        <div className="h-32 bg-gray-200 rounded animate-pulse" />
      </div>
    );
  }

  if (!stats) return null;

  const getStatusColor = () => {
    if (stats.isPaused) return "red";
    if (stats.consecutiveFailures >= 3) return "yellow";
    if (stats.recentFailureRate > 50) return "yellow";
    return "green";
  };

  const statusColor = getStatusColor();

  return (
    <div className="border border-gray-200 rounded-lg p-6">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <AlertCircle className="w-5 h-5" />
        Health & Reliability
      </h2>

      {stats.isPaused && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-red-900">Job Automatically Paused</p>
            <p className="text-sm text-red-700">
              This job has been paused after 5 consecutive failures. Review the
              workflow and resume when ready.
            </p>
          </div>
        </div>
      )}

      {!stats.isPaused && stats.consecutiveFailures >= 3 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-yellow-900">
              Warning: Multiple Failures
            </p>
            <p className="text-sm text-yellow-700">
              This job has failed {stats.consecutiveFailures} times
              consecutively. Will auto-pause after 5 failures.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">Status</span>
            {statusColor === "green" && (
              <CheckCircle className="w-5 h-5 text-green-600" />
            )}
            {statusColor === "yellow" && (
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
            )}
            {statusColor === "red" && (
              <AlertCircle className="w-5 h-5 text-red-600" />
            )}
          </div>
          <p
            className={`text-2xl font-bold ${
              statusColor === "green"
                ? "text-green-600"
                : statusColor === "yellow"
                ? "text-yellow-600"
                : "text-red-600"
            }`}
          >
            {statusColor === "green"
              ? "Healthy"
              : statusColor === "yellow"
              ? "Warning"
              : "Critical"}
          </p>
        </div>

        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600 mb-2">Consecutive Failures</p>
          <p className="text-2xl font-bold">{stats.consecutiveFailures}</p>
          <p className="text-xs text-gray-500 mt-1">
            of 5 max before auto-pause
          </p>
        </div>

        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600 mb-2">Recent Failure Rate</p>
          <p className="text-2xl font-bold">{stats.recentFailureRate}%</p>
          <p className="text-xs text-gray-500 mt-1">
            Last {stats.totalRecentExecutions} executions
          </p>
        </div>

        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600 mb-2">Last Failure</p>
          <p className="text-sm font-medium">
            {stats.lastFailureAt
              ? new Date(stats.lastFailureAt).toLocaleString()
              : "Never"}
          </p>
        </div>
      </div>

      {stats.consecutiveFailures > 0 && !stats.isPaused && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-sm text-blue-900">
            💡 <strong>Tip:</strong> Check execution logs to identify the cause
            of failures. A successful execution will reset the failure counter.
          </p>
        </div>
      )}
    </div>
  );
}

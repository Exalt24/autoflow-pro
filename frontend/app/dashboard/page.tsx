"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/dashboard/StatCard";
import ExecutionVolumeChart from "@/components/dashboard/ExecutionVolumeChart";
import SuccessRateChart from "@/components/dashboard/SuccessRateChart";
import UsageQuotaCard from "@/components/dashboard/UsageQuotaCard";
import {
  analyticsApi,
  workflowsApi,
  executionsApi,
  UserStats,
  ExecutionTrend,
  UsageQuota,
  Workflow,
  Execution,
} from "@/lib/api";
import {
  Activity,
  CheckCircle,
  Clock,
  Workflow as WorkflowIcon,
  ArrowRight,
} from "lucide-react";
import { formatDate, formatDuration } from "@/lib/utils";

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [trends, setTrends] = useState<ExecutionTrend[]>([]);
  const [usage, setUsage] = useState<UsageQuota | null>(null);
  const [recentWorkflows, setRecentWorkflows] = useState<Workflow[]>([]);
  const [recentExecutions, setRecentExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [
          statsData,
          trendsData,
          usageData,
          workflowsData,
          executionsData,
        ] = await Promise.all([
          analyticsApi.getStats(),
          analyticsApi.getTrends(7),
          analyticsApi.getUsage(),
          workflowsApi.list({ page: 1, limit: 5 }),
          executionsApi.list({ page: 1, limit: 5 }),
        ]);

        setStats(statsData);
        setTrends(trendsData);
        setUsage(usageData);
        setRecentWorkflows(workflowsData.workflows);
        setRecentExecutions(executionsData.executions);
      } catch (error) {
        console.error("Failed to fetch dashboard data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold mb-8">Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-32 bg-gray-200 animate-pulse rounded-lg"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-96 bg-gray-200 animate-pulse rounded-lg" />
          <div className="h-96 bg-gray-200 animate-pulse rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <Button
          variant="outline"
          onClick={() => router.push("/dashboard/analytics")}
        >
          View Full Analytics
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Total Workflows"
          value={stats?.totalWorkflows || 0}
          icon={WorkflowIcon}
          loading={!stats}
        />
        <StatCard
          title="Total Executions"
          value={stats?.totalExecutions || 0}
          icon={Activity}
          trend={stats ? { value: 12, isPositive: true } : undefined}
          loading={!stats}
        />
        <StatCard
          title="Success Rate"
          value={stats ? `${stats.successRate.toFixed(1)}%` : "0%"}
          icon={CheckCircle}
          loading={!stats}
        />
        <StatCard
          title="Avg Duration"
          value={stats ? formatDuration(stats.avgExecutionTime) : "0s"}
          icon={Clock}
          loading={!stats}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ExecutionVolumeChart data={trends} loading={!trends} />
        <SuccessRateChart stats={stats!} loading={!stats} />
      </div>

      {/* Usage Quota */}
      <div className="mb-8">
        <UsageQuotaCard quota={usage!} loading={!usage} />
      </div>

      {/* Recent Items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Workflows */}
        <Card>
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Recent Workflows</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/dashboard/workflows")}
              >
                View All
              </Button>
            </div>
            {recentWorkflows.length === 0 ? (
              <div className="text-center py-8">
                <WorkflowIcon className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500 mb-4">No workflows yet</p>
                <Button
                  variant="secondary"
                  onClick={() => router.push("/dashboard/workflows")}
                >
                  Create Your First Workflow
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {recentWorkflows.map((workflow) => (
                  <div
                    key={workflow.id}
                    className="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => router.push("/dashboard/workflows")}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{workflow.name}</p>
                        <p className="text-sm text-gray-500">
                          {workflow.definition.steps.length} steps • Updated{" "}
                          {formatDate(workflow.updated_at)}
                        </p>
                      </div>
                      <div className="ml-3">
                        <span
                          className={`text-xs px-2 py-1 rounded ${
                            workflow.status === "active"
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {workflow.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Recent Executions */}
        <Card>
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Recent Executions</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/dashboard/executions")}
              >
                View All
              </Button>
            </div>
            {recentExecutions.length === 0 ? (
              <div className="text-center py-8">
                <Activity className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500 mb-4">No executions yet</p>
                <Button
                  variant="secondary"
                  onClick={() => router.push("/dashboard/workflows")}
                >
                  Execute a Workflow
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {recentExecutions.map((execution) => (
                  <div
                    key={execution.id}
                    className="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() =>
                      router.push(`/dashboard/executions/${execution.id}`)
                    }
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`text-xs px-2 py-1 rounded ${
                              execution.status === "completed"
                                ? "bg-green-100 text-green-700"
                                : execution.status === "failed"
                                ? "bg-red-100 text-red-700"
                                : execution.status === "running"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {execution.status}
                          </span>
                          {execution.status === "running" && (
                            <div className="flex items-center gap-1">
                              <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                              <span className="text-xs text-gray-600">
                                Live
                              </span>
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-gray-600">
                          Started {formatDate(execution.started_at)}
                          {execution.duration &&
                            ` • ${formatDuration(execution.duration)}`}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

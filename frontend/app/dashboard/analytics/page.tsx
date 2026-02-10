"use client";

import { useEffect, useState, useMemo, Suspense, lazy } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  analyticsApi,
  archivalApi,
  UserStats,
  ExecutionTrend,
  TopWorkflow,
  UsageQuota,
  ErrorAnalysis,
  SlowestWorkflow,
  ResourceUsage,
  ArchivalStats as ArchivalStatsType,
} from "@/lib/api";
import { Download, Calendar } from "lucide-react";
import { Toast } from "@/components/ui/Toast";

const ExecutionVolumeChart = lazy(
  () => import("@/components/dashboard/ExecutionVolumeChart")
);
const SuccessRateChart = lazy(
  () => import("@/components/dashboard/SuccessRateChart")
);
const TopWorkflowsChart = lazy(
  () => import("@/components/dashboard/TopWorkflowsChart")
);
const ExecutionDurationChart = lazy(
  () => import("@/components/dashboard/ExecutionDurationChart")
);
const UsageQuotaCard = lazy(
  () => import("@/components/dashboard/UsageQuotaCard")
);
const ErrorAnalysisTable = lazy(
  () => import("@/components/dashboard/ErrorAnalysisTable")
);
const ArchivalStats = lazy(
  () => import("@/components/dashboard/ArchivalStats")
);
const ArchivalControls = lazy(
  () => import("@/components/dashboard/ArchivalControls")
);
const ResourceUsageCard = lazy(
  () => import("@/components/dashboard/ResourceUsageCard")
);

const ChartSkeleton = () => (
  <Card>
    <div className="p-6">
      <div className="h-6 w-48 bg-gray-200 animate-pulse rounded mb-4" />
      <div className="h-80 bg-gray-200 animate-pulse rounded" />
    </div>
  </Card>
);

export default function AnalyticsPage() {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [trends, setTrends] = useState<ExecutionTrend[]>([]);
  const [topWorkflows, setTopWorkflows] = useState<TopWorkflow[]>([]);
  const [usage, setUsage] = useState<UsageQuota | null>(null);
  const [errors, setErrors] = useState<ErrorAnalysis[]>([]);
  const [slowest, setSlowest] = useState<SlowestWorkflow[]>([]);
  const [archivalStats, setArchivalStats] = useState<ArchivalStatsType | null>(
    null
  );
  const [resources, setResources] = useState<ResourceUsage | null>(null);
  const [timeRange, setTimeRange] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{message: string; type: "success" | "error" | "info"} | null>(null);

  const fetchData = async (days: number) => {
    setLoading(true);
    setError(null);
    try {
      const [
        statsData,
        trendsData,
        topWorkflowsData,
        usageData,
        errorsData,
        slowestData,
        archivalStatsData,
        resourcesData,
      ] = await Promise.all([
        analyticsApi.getStats(),
        analyticsApi.getTrends(days),
        analyticsApi.getTopWorkflows(10),
        analyticsApi.getUsage(),
        analyticsApi.getErrors(10),
        analyticsApi.getSlowestWorkflows(10),
        archivalApi.getStats(),
        analyticsApi.getResources(),
      ]);

      setStats(statsData);
      setTrends(trendsData);
      setTopWorkflows(topWorkflowsData);
      setUsage(usageData);
      setErrors(errorsData);
      setSlowest(slowestData);
      setArchivalStats(archivalStatsData);
      setResources(resourcesData);
    } catch (error) {
      console.error("Failed to fetch analytics data:", error);
      setError(
        error instanceof Error ? error.message : "Failed to load analytics data"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(timeRange);
  }, [timeRange]);

  const exportData = useMemo(
    () => ({
      stats,
      trends,
      topWorkflows,
      usage,
      errors,
      slowest,
      archivalStats,
      resources,
      exportedAt: new Date().toISOString(),
    }),
    [
      stats,
      trends,
      topWorkflows,
      usage,
      errors,
      slowest,
      archivalStats,
      resources,
    ]
  );

  const handleExportJSON = () => {
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleExportCSV = () => {
    if (!trends || trends.length === 0) {
      setToast({message: "No data to export", type: "info"});
      return;
    }

    const rows = [
      ["Date", "Total Executions", "Successful", "Failed"],
      ...trends.map((t) => [
        t.date,
        t.total.toString(),
        t.successful.toString(),
        t.failed.toString(),
      ]),
    ];

    const csv = rows.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleArchiveComplete = () => {
    fetchData(timeRange);
  };

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md">
          <div className="p-6 text-center">
            <p className="text-red-600 font-semibold mb-2">
              Failed to load analytics
            </p>
            <p className="text-gray-600 text-sm mb-4">{error}</p>
            <Button onClick={() => fetchData(timeRange)}>Retry</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Analytics</h1>
          <p className="text-gray-600">
            Comprehensive workflow performance insights
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 border rounded-md bg-white">
            <Calendar className="h-4 w-4 text-gray-500" />
            <select
              title="Select Time Range"
              value={timeRange}
              onChange={(e) => setTimeRange(Number(e.target.value))}
              className="text-sm focus:outline-none bg-transparent"
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
          <Button variant="secondary" onClick={handleExportJSON}>
            <Download className="h-4 w-4 mr-2" />
            Export JSON
          </Button>
          <Button variant="secondary" onClick={handleExportCSV}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card>
          <div className="p-6">
            <p className="text-sm text-gray-600 mb-1">Total Workflows</p>
            <p className="text-3xl font-bold">{stats?.totalWorkflows || 0}</p>
          </div>
        </Card>
        <Card>
          <div className="p-6">
            <p className="text-sm text-gray-600 mb-1">Total Executions</p>
            <p className="text-3xl font-bold">{stats?.totalExecutions || 0}</p>
          </div>
        </Card>
        <Card>
          <div className="p-6">
            <p className="text-sm text-gray-600 mb-1">Success Rate</p>
            <p className="text-3xl font-bold">
              {stats?.successRate.toFixed(1) || 0}%
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-6">
            <p className="text-sm text-gray-600 mb-1">Avg Duration</p>
            <p className="text-3xl font-bold">
              {stats ? `${(stats.averageDuration / 1000).toFixed(1)}s` : "0s"}
            </p>
          </div>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Suspense fallback={<ChartSkeleton />}>
          <ExecutionVolumeChart data={trends} loading={loading} />
        </Suspense>
        <Suspense fallback={<ChartSkeleton />}>
          <SuccessRateChart stats={stats} loading={loading} />
        </Suspense>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Suspense fallback={<ChartSkeleton />}>
          <TopWorkflowsChart data={topWorkflows} loading={loading} />
        </Suspense>
        <Suspense fallback={<ChartSkeleton />}>
          <ExecutionDurationChart data={slowest} loading={loading} />
        </Suspense>
      </div>

      {/* Charts Row 3 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Suspense fallback={<ChartSkeleton />}>
          <UsageQuotaCard quota={usage} loading={loading} />
        </Suspense>
        <Suspense fallback={<ChartSkeleton />}>
          <ErrorAnalysisTable data={errors} loading={loading} />
        </Suspense>
      </div>

      {/* Archival Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Suspense fallback={<ChartSkeleton />}>
          <ArchivalStats stats={archivalStats} loading={loading} />
        </Suspense>
        <Suspense fallback={<ChartSkeleton />}>
          <ArchivalControls onArchiveComplete={handleArchiveComplete} />
        </Suspense>
      </div>

      {/* Resource Monitoring */}
      <div className="mb-8">
        <Suspense fallback={<ChartSkeleton />}>
          <ResourceUsageCard resources={resources} loading={loading} />
        </Suspense>
      </div>

      {/* Performance Insights */}
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Performance Insights</h3>
          <div className="space-y-4">
            {stats && stats.successRate < 70 && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                <p className="text-sm font-medium text-yellow-900">
                  Low Success Rate
                </p>
                <p className="text-sm text-yellow-700 mt-1">
                  Your success rate is below 70%. Review failed executions to
                  identify common issues with selectors or network timeouts.
                </p>
              </div>
            )}

            {stats && stats.averageDuration > 60000 && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                <p className="text-sm font-medium text-blue-900">
                  Long Execution Times
                </p>
                <p className="text-sm text-blue-700 mt-1">
                  Average execution time exceeds 1 minute. Consider optimizing
                  wait times and removing unnecessary steps.
                </p>
              </div>
            )}

            {usage &&
              (usage.executionsCount / usage.executionsLimit) * 100 > 80 && (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-md">
                  <p className="text-sm font-medium text-orange-900">
                    Approaching Execution Limit
                  </p>
                  <p className="text-sm text-orange-700 mt-1">
                    You&apos;ve used {usage.executionsCount} of{" "}
                    {usage.executionsLimit} executions this month. Consider
                    upgrading for more capacity.
                  </p>
                </div>
              )}

            {stats &&
              stats.successRate >= 90 &&
              stats.averageDuration < 30000 && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                  <p className="text-sm font-medium text-green-900">
                    Excellent Performance
                  </p>
                  <p className="text-sm text-green-700 mt-1">
                    Your workflows are performing exceptionally well with high
                    success rates and fast execution times!
                  </p>
                </div>
              )}
          </div>
        </div>
      </Card>
    </div>
  );
}

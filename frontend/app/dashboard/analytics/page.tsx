"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ExecutionVolumeChart } from "@/components/dashboard/ExecutionVolumeChart";
import { SuccessRateChart } from "@/components/dashboard/SuccessRateChart";
import { TopWorkflowsChart } from "@/components/dashboard/TopWorkflowsChart";
import { UsageQuotaCard } from "@/components/dashboard/UsageQuotaCard";
import {
  analyticsApi,
  UserStats,
  ExecutionTrend,
  TopWorkflow,
  UsageQuota,
} from "@/lib/api";
import { Download, Calendar } from "lucide-react";

export default function AnalyticsPage() {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [trends, setTrends] = useState<ExecutionTrend[]>([]);
  const [topWorkflows, setTopWorkflows] = useState<TopWorkflow[]>([]);
  const [usage, setUsage] = useState<UsageQuota | null>(null);
  const [timeRange, setTimeRange] = useState(7);
  const [loading, setLoading] = useState(true);

  const fetchData = async (days: number) => {
    setLoading(true);
    try {
      const [statsData, trendsData, topWorkflowsData, usageData] =
        await Promise.all([
          analyticsApi.getStats(),
          analyticsApi.getTrends(days),
          analyticsApi.getTopWorkflows(10),
          analyticsApi.getUsage(),
        ]);

      setStats(statsData);
      setTrends(trendsData);
      setTopWorkflows(topWorkflowsData);
      setUsage(usageData);
    } catch (error) {
      console.error("Failed to fetch analytics data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(timeRange);
  }, [timeRange]);

  const handleExportJSON = () => {
    const data = {
      stats,
      trends,
      topWorkflows,
      usage,
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
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
      alert("No data to export");
      return;
    }

    const rows = [
      ["Date", "Total Executions", "Successful", "Failed"],
      ...trends.map((t) => [
        t.date,
        t.count.toString(),
        t.successCount.toString(),
        t.failureCount.toString(),
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

  return (
    <div>
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
              {stats ? `${(stats.avgExecutionTime / 1000).toFixed(1)}s` : "0s"}
            </p>
          </div>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ExecutionVolumeChart data={trends} loading={loading} />
        <SuccessRateChart stats={stats!} loading={loading} />
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <TopWorkflowsChart data={topWorkflows} loading={loading} />
        <UsageQuotaCard quota={usage!} loading={loading} />
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

            {stats && stats.avgExecutionTime > 60000 && (
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
              stats.avgExecutionTime < 30000 && (
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

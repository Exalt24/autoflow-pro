"use client";

import { memo, useMemo } from "react";
import { Card } from "@/components/ui/Card";
import { ExecutionTrend } from "@/lib/api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface ExecutionVolumeChartProps {
  data: ExecutionTrend[];
  loading?: boolean;
}

const ExecutionVolumeChart = memo(function ExecutionVolumeChart({
  data,
  loading = false,
}: ExecutionVolumeChartProps) {
  const chartData = useMemo(
    () =>
      data.map((item) => ({
        date: new Date(item.date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        Total: item.count,
        Success: item.successCount,
        Failed: item.failureCount,
      })),
    [data]
  );

  if (loading) {
    return (
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Execution Volume</h3>
          <div className="h-80 bg-gray-200 animate-pulse rounded" />
        </div>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Execution Volume</h3>
          <div className="h-80 flex items-center justify-center text-gray-500">
            No execution data available
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold mb-4">
          Execution Volume (Last 7 Days)
        </h3>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="Total"
              stroke="#3b82f6"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="Success"
              stroke="#10b981"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="Failed"
              stroke="#ef4444"
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
});

export default ExecutionVolumeChart;

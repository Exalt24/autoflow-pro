"use client";

import { Card } from "@/components/ui/Card";
import { SlowestWorkflow } from "@/lib/api";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { truncate } from "@/lib/utils";

interface ExecutionDurationChartProps {
  data: SlowestWorkflow[];
  loading?: boolean;
}

export function ExecutionDurationChart({
  data,
  loading = false,
}: ExecutionDurationChartProps) {
  if (loading) {
    return (
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">
            Slowest Workflows (Avg Duration)
          </h3>
          <div className="h-80 bg-gray-200 animate-pulse rounded" />
        </div>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">
            Slowest Workflows (Avg Duration)
          </h3>
          <div className="h-80 flex items-center justify-center text-gray-500">
            No execution data available
          </div>
        </div>
      </Card>
    );
  }

  const chartData = data.map((item) => ({
    name: truncate(item.workflowName, 20),
    duration: (item.averageDuration / 1000).toFixed(1),
    executions: item.executionCount,
  }));

  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold mb-4">
          Slowest Workflows (Avg Duration)
        </h3>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              label={{ value: "Seconds", position: "insideBottom", offset: -5 }}
            />
            <YAxis dataKey="name" type="category" width={150} />
            <Tooltip
              formatter={(value: number) => [`${value}s`, "Avg Duration"]}
              labelFormatter={(label) => `Workflow: ${label}`}
            />
            <Bar dataKey="duration" fill="#f59e0b" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

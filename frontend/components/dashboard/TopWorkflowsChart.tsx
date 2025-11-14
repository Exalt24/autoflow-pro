"use client";

import { Card } from "@/components/ui/Card";
import { TopWorkflow } from "@/lib/api";
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

interface TopWorkflowsChartProps {
  data: TopWorkflow[];
  loading?: boolean;
}

export function TopWorkflowsChart({
  data,
  loading = false,
}: TopWorkflowsChartProps) {
  if (loading) {
    return (
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Most Used Workflows</h3>
          <div className="h-80 bg-gray-200 animate-pulse rounded" />
        </div>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Most Used Workflows</h3>
          <div className="h-80 flex items-center justify-center text-gray-500">
            No workflow data available
          </div>
        </div>
      </Card>
    );
  }

  const chartData = data.map((item) => ({
    name: truncate(item.workflowName, 20),
    executions: item.executionCount,
  }));

  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold mb-4">
          Most Used Workflows (Top 10)
        </h3>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" />
            <YAxis dataKey="name" type="category" width={150} />
            <Tooltip />
            <Bar dataKey="executions" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

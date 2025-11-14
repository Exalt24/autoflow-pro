"use client";

import { Card } from "@/components/ui/Card";
import { UserStats } from "@/lib/api";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";

interface SuccessRateChartProps {
  stats: UserStats;
  loading?: boolean;
}

export function SuccessRateChart({
  stats,
  loading = false,
}: SuccessRateChartProps) {
  if (loading) {
    return (
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Success Rate</h3>
          <div className="h-80 bg-gray-200 animate-pulse rounded" />
        </div>
      </Card>
    );
  }

  const successCount = Math.round(
    stats.totalExecutions * (stats.successRate / 100)
  );
  const failureCount = stats.totalExecutions - successCount;

  const data = [
    { name: "Success", value: successCount, color: "#10b981" },
    { name: "Failed", value: failureCount, color: "#ef4444" },
  ];

  if (stats.totalExecutions === 0) {
    return (
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Success Rate</h3>
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
        <h3 className="text-lg font-semibold mb-4">Success Rate</h3>
        <div className="text-center mb-4">
          <div className="text-4xl font-bold text-primary">
            {stats.successRate.toFixed(1)}%
          </div>
          <div className="text-sm text-gray-600 mt-1">
            {successCount} successful out of {stats.totalExecutions} total
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percent }) =>
                `${name}: ${percent ? (percent * 100).toFixed(0) : 0}%`
              }
              outerRadius={80}
              fill="#8884d8"
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

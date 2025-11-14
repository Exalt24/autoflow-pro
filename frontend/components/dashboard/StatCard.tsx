import { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  loading?: boolean;
}

export function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  loading,
}: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-600">{title}</p>
            {loading ? (
              <div className="mt-2 h-8 w-24 bg-gray-200 animate-pulse rounded"></div>
            ) : (
              <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
            )}
            {trend && !loading && (
              <p
                className={`mt-2 text-sm font-medium ${
                  trend.isPositive ? "text-success" : "text-danger"
                }`}
              >
                {trend.isPositive ? "↑" : "↓"} {Math.abs(trend.value)}%
              </p>
            )}
          </div>
          <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-6 h-6 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

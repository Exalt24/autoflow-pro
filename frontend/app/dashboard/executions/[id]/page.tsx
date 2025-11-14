"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ExecutionDetail } from "@/components/execution/ExecutionDetail";
import { executionsApi, Execution } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { ArrowLeft } from "lucide-react";

export default function ExecutionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const executionId = params.id as string;

  const [execution, setExecution] = useState<Execution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchExecution = async () => {
      try {
        const result = await executionsApi.getById(executionId);
        setExecution(result);
      } catch (err) {
        console.error("Failed to fetch execution:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load execution"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchExecution();
  }, [executionId]);

  if (loading) {
    return (
      <div>
        <Button variant="ghost" onClick={() => router.back()} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="space-y-6">
          <div className="h-48 bg-gray-200 animate-pulse rounded-lg" />
          <div className="h-96 bg-gray-200 animate-pulse rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !execution) {
    return (
      <div>
        <Button variant="ghost" onClick={() => router.back()} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="p-12 text-center">
          <p className="text-red-600 mb-4">{error || "Execution not found"}</p>
          <Button
            variant="secondary"
            onClick={() => router.push("/dashboard/executions")}
          >
            View All Executions
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Button variant="ghost" onClick={() => router.back()} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Executions
      </Button>

      <ExecutionDetail execution={execution} />
    </div>
  );
}

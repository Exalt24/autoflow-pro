"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { archivalApi } from "@/lib/api";
import { Archive, CheckCircle, XCircle, Loader2 } from "lucide-react";

interface ArchivalControlsProps {
  onArchiveComplete: () => void;
}

export default function ArchivalControls({
  onArchiveComplete,
}: ArchivalControlsProps) {
  const [archiving, setArchiving] = useState(false);
  const [result, setResult] = useState<{
    total: number;
    successful: number;
    failed: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleArchive = async () => {
    if (
      !confirm(
        "Archive old executions (30+ days)? This will move data to R2 storage."
      )
    ) {
      return;
    }

    setArchiving(true);
    setError(null);
    setResult(null);

    try {
      const archivalResult = await archivalApi.archiveBatch();
      setResult({
        total: archivalResult.total,
        successful: archivalResult.successful,
        failed: archivalResult.failed,
      });

      if (archivalResult.successful > 0) {
        onArchiveComplete();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to archive executions"
      );
    } finally {
      setArchiving(false);
    }
  };

  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold mb-4">Manual Archival</h3>
        <p className="text-sm text-gray-600 mb-4">
          Archive executions older than 30 days to R2 storage. Archived data
          remains accessible but frees up database space.
        </p>

        <Button
          onClick={handleArchive}
          disabled={archiving}
          className="w-full mb-4"
        >
          {archiving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Archiving...
            </>
          ) : (
            <>
              <Archive className="h-4 w-4 mr-2" />
              Archive Old Executions
            </>
          )}
        </Button>

        {result && (
          <div className="space-y-2">
            {result.successful > 0 && (
              <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-md">
                <CheckCircle className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-900">
                    Successfully Archived
                  </p>
                  <p className="text-sm text-green-700">
                    {result.successful} execution
                    {result.successful !== 1 ? "s" : ""} moved to R2 storage
                  </p>
                </div>
              </div>
            )}

            {result.failed > 0 && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
                <XCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-900">Failed</p>
                  <p className="text-sm text-red-700">
                    {result.failed} execution{result.failed !== 1 ? "s" : ""}{" "}
                    could not be archived
                  </p>
                </div>
              </div>
            )}

            {result.total === 0 && (
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-md">
                <p className="text-sm text-gray-700">
                  No executions eligible for archival at this time.
                </p>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
            <XCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-900">Error</p>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        )}

        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-sm text-blue-900 font-medium mb-1">
            Automatic Archival
          </p>
          <p className="text-sm text-blue-700">
            Executions are automatically archived daily at 2:00 AM. Manual
            archival is available for immediate cleanup.
          </p>
        </div>
      </div>
    </Card>
  );
}

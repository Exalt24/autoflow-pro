"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Download, Copy, Check, Database } from "lucide-react";

interface DataViewerProps {
  data: Record<string, unknown>;
  executionId: string;
}

export function DataViewer({ data, executionId }: DataViewerProps) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"formatted" | "raw">("formatted");

  const isEmpty = Object.keys(data).length === 0;

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadJSON = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `execution-${executionId}-data.json`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleDownloadCSV = () => {
    const rows: string[][] = [];

    // Handle simple flat objects
    if (typeof data === "object" && !Array.isArray(data)) {
      rows.push(["Field", "Value"]);
      Object.entries(data).forEach(([key, value]) => {
        rows.push([key, String(value)]);
      });
    }

    const csv = rows
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `execution-${executionId}-data.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const renderValue = (value: unknown): string => {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean")
      return String(value);
    return JSON.stringify(value);
  };

  if (isEmpty) {
    return (
      <Card>
        <div className="p-8 text-center">
          <Database className="h-12 w-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-500">No data extracted</p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="p-4 border-b flex items-center justify-between">
        <h3 className="font-medium">Extracted Data</h3>
        <div className="flex items-center gap-2">
          <div className="flex items-center border rounded-md overflow-hidden">
            <button
              onClick={() => setViewMode("formatted")}
              className={`px-3 py-1 text-sm ${
                viewMode === "formatted"
                  ? "bg-primary text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              Formatted
            </button>
            <button
              onClick={() => setViewMode("raw")}
              className={`px-3 py-1 text-sm ${
                viewMode === "raw"
                  ? "bg-primary text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              Raw JSON
            </button>
          </div>
          <Button variant="secondary" size="sm" onClick={handleCopy}>
            {copied ? (
              <>
                <Check className="h-4 w-4 mr-2" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </>
            )}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleDownloadJSON}>
            <Download className="h-4 w-4 mr-2" />
            JSON
          </Button>
          <Button variant="secondary" size="sm" onClick={handleDownloadCSV}>
            <Download className="h-4 w-4 mr-2" />
            CSV
          </Button>
        </div>
      </div>

      <div className="p-4">
        {viewMode === "formatted" ? (
          <div className="space-y-3">
            {Object.entries(data).map(([key, value]) => (
              <div key={key} className="border-b pb-3 last:border-b-0">
                <div className="text-sm font-medium text-gray-700 mb-1">
                  {key}
                </div>
                <div className="text-sm text-gray-900 font-mono bg-gray-50 p-2 rounded">
                  {renderValue(value)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <pre className="text-sm font-mono bg-gray-50 p-4 rounded overflow-x-auto">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </Card>
  );
}

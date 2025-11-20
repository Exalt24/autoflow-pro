"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  Database,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Info,
} from "lucide-react";
import { analyticsApi } from "@/lib/api";

export default function SettingsPage() {
  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRetentionPolicy();
  }, []);

  const fetchRetentionPolicy = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await analyticsApi.getRetentionPolicy();
      setRetentionDays(data.retentionDays);
    } catch (err) {
      console.error("Failed to fetch retention policy:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load retention policy"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSuccess(false);
    setError(null);

    try {
      await analyticsApi.updateRetentionPolicy(retentionDays);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to update retention policy:", err);
      setError(
        err instanceof Error ? err.message : "Failed to update retention policy"
      );
    } finally {
      setSaving(false);
    }
  };

  const options = [
    {
      value: 7,
      label: "7 days",
      description: "Archive data after 1 week",
      storage: "Minimal storage usage",
      color: "text-green-600",
      bg: "bg-green-50",
      border: "border-green-200",
    },
    {
      value: 30,
      label: "30 days",
      description: "Archive data after 1 month (Default)",
      storage: "Balanced storage usage",
      color: "text-blue-600",
      bg: "bg-blue-50",
      border: "border-blue-200",
    },
    {
      value: 90,
      label: "90 days",
      description: "Archive data after 3 months",
      storage: "Higher storage usage",
      color: "text-orange-600",
      bg: "bg-orange-50",
      border: "border-orange-200",
    },
  ];

  const selectedOption = options.find((opt) => opt.value === retentionDays);

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">Settings</h1>
      <p className="text-gray-600 mb-8">
        Manage your account preferences and data retention policy
      </p>

      {/* Data Retention Policy */}
      <Card>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Database className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Data Retention Policy</h2>
              <p className="text-sm text-gray-600">
                Configure how long execution data is kept before archival
              </p>
            </div>
          </div>

          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-24 bg-gray-200 animate-pulse rounded-lg"
                />
              ))}
            </div>
          ) : (
            <>
              {/* Info Box */}
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <Info className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div className="text-sm text-blue-900">
                    <p className="font-medium mb-1">How archival works:</p>
                    <ul className="list-disc list-inside space-y-1 text-blue-800">
                      <li>
                        Executions older than your selected period are moved to
                        Cloudflare R2 storage
                      </li>
                      <li>
                        Archived data remains accessible but takes longer to
                        load
                      </li>
                      <li>
                        Archival frees up database storage and improves
                        performance
                      </li>
                      <li>You can restore archived executions at any time</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Retention Options */}
              <div className="space-y-3 mb-6">
                {options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRetentionDays(option.value)}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                      retentionDays === option.value
                        ? `${option.border} ${option.bg}`
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-1 ${
                            retentionDays === option.value
                              ? option.bg
                              : "bg-gray-100"
                          } p-2 rounded`}
                        >
                          <Calendar
                            className={`h-5 w-5 ${
                              retentionDays === option.value
                                ? option.color
                                : "text-gray-400"
                            }`}
                          />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold text-gray-900">
                              {option.label}
                            </p>
                            {option.value === 30 && (
                              <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                                Recommended
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600">
                            {option.description}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {option.storage}
                          </p>
                        </div>
                      </div>
                      {retentionDays === option.value && (
                        <CheckCircle2
                          className={`h-5 w-5 ${option.color} mt-1`}
                        />
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {/* Current Selection Summary */}
              {selectedOption && (
                <div className={`p-4 ${selectedOption.bg} rounded-lg mb-6`}>
                  <p className="text-sm font-medium text-gray-900 mb-1">
                    Current Policy:
                  </p>
                  <p className={`text-sm ${selectedOption.color}`}>
                    Executions older than {selectedOption.label.toLowerCase()}{" "}
                    will be automatically archived to Cloudflare R2 storage.
                  </p>
                </div>
              )}

              {/* Success/Error Messages */}
              {success && (
                <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center gap-2 text-green-900">
                    <CheckCircle2 className="h-5 w-5" />
                    <p className="text-sm font-medium">
                      Retention policy updated successfully!
                    </p>
                  </div>
                </div>
              )}

              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-center gap-2 text-red-900">
                    <AlertCircle className="h-5 w-5" />
                    <p className="text-sm font-medium">{error}</p>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-3">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={fetchRetentionPolicy}
                  disabled={loading || saving}
                >
                  Reset
                </Button>
              </div>

              {/* Warning Box */}
              <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                  <div className="text-sm text-yellow-900">
                    <p className="font-medium mb-1">Important:</p>
                    <p className="text-yellow-800">
                      Changing your retention policy does not affect
                      already-archived data. Only new executions will follow the
                      updated schedule. Archived data remains in R2 storage
                      until manually deleted.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

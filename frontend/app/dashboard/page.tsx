"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { signOut } from "@/lib/auth";

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  async function handleSignOut() {
    await signOut();
    window.location.href = "/";
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-bg">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-dark-bg p-8">
      <div className="max-w-7xl mx-auto">
        <div className="bg-dark-card p-6 rounded-lg border border-dark-border mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Dashboard</h1>
              <p className="text-gray-400">Welcome back, {user.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="bg-danger hover:bg-danger/90 text-white px-4 py-2 rounded-md transition"
            >
              Sign Out
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-dark-card p-6 rounded-lg border border-dark-border">
            <h3 className="text-xl font-semibold text-white mb-2">Workflows</h3>
            <p className="text-4xl font-bold text-primary">0</p>
            <p className="text-gray-400 text-sm mt-2">
              Total workflows created
            </p>
          </div>

          <div className="bg-dark-card p-6 rounded-lg border border-dark-border">
            <h3 className="text-xl font-semibold text-white mb-2">
              Executions
            </h3>
            <p className="text-4xl font-bold text-secondary">0</p>
            <p className="text-gray-400 text-sm mt-2">Total executions</p>
          </div>

          <div className="bg-dark-card p-6 rounded-lg border border-dark-border">
            <h3 className="text-xl font-semibold text-white mb-2">
              Success Rate
            </h3>
            <p className="text-4xl font-bold text-success">100%</p>
            <p className="text-gray-400 text-sm mt-2">Execution success rate</p>
          </div>
        </div>

        <div className="mt-8 bg-dark-card p-6 rounded-lg border border-dark-border">
          <h2 className="text-2xl font-bold text-white mb-4">
            Getting Started
          </h2>
          <p className="text-gray-400 mb-4">
            Authentication is working! This dashboard will be populated with
            real data in Phase 4.
          </p>
          <div className="space-y-2">
            <p className="text-gray-300">✅ User authenticated</p>
            <p className="text-gray-300">✅ Session active</p>
            <p className="text-gray-300">✅ Database connected</p>
            <p className="text-gray-300">
              ⏳ Waiting for Phase 2 (Backend Core Infrastructure)
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

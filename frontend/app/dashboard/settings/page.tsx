"use client";

import { Card } from "@/components/ui/Card";
import { Settings as SettingsIcon } from "lucide-react";

export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Settings</h1>

      <Card>
        <div className="p-12 text-center">
          <SettingsIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Settings Coming Soon</h2>
          <p className="text-gray-600">
            User preferences, account settings, and configuration options will
            be available here.
          </p>
        </div>
      </Card>
    </div>
  );
}

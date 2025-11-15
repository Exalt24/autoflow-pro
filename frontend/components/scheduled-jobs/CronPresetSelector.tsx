"use client";

interface CronPreset {
  label: string;
  value: string;
  description: string;
}

const CRON_PRESETS: CronPreset[] = [
  {
    label: "Every minute",
    value: "* * * * *",
    description: "Runs every minute",
  },
  {
    label: "Every 5 minutes",
    value: "*/5 * * * *",
    description: "Runs every 5 minutes",
  },
  {
    label: "Every 15 minutes",
    value: "*/15 * * * *",
    description: "Runs every 15 minutes",
  },
  {
    label: "Every 30 minutes",
    value: "*/30 * * * *",
    description: "Runs every 30 minutes",
  },
  {
    label: "Every hour",
    value: "0 * * * *",
    description: "Runs at minute 0 of every hour",
  },
  {
    label: "Every day at midnight",
    value: "0 0 * * *",
    description: "Runs at 00:00 every day",
  },
  {
    label: "Every day at 9 AM",
    value: "0 9 * * *",
    description: "Runs at 09:00 every day",
  },
  {
    label: "Every Monday at 9 AM",
    value: "0 9 * * 1",
    description: "Runs at 09:00 every Monday",
  },
  {
    label: "Every 1st of month",
    value: "0 0 1 * *",
    description: "Runs at 00:00 on day 1 of every month",
  },
];

interface CronPresetSelectorProps {
  value: string;
  onChange: (value: string) => void;
  onCustom: () => void;
  showCustom: boolean;
}

export function CronPresetSelector({
  value,
  onChange,
  onCustom,
  showCustom,
}: CronPresetSelectorProps) {
  const isCustom = !CRON_PRESETS.find((p) => p.value === value);

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium mb-2">Schedule</label>
        <select
          value={isCustom ? "custom" : value}
          onChange={(e) => {
            if (e.target.value === "custom") {
              onCustom();
            } else {
              onChange(e.target.value);
            }
          }}
          className="w-full h-10 px-3 border border-gray-300 rounded-md"
          aria-label="Select schedule preset"
        >
          {CRON_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
          <option value="custom">Custom expression...</option>
        </select>
      </div>

      {showCustom && (
        <div>
          <label className="block text-sm font-medium mb-2">
            Custom Cron Expression
          </label>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="* * * * *"
            className="w-full h-10 px-3 border border-gray-300 rounded-md font-mono text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            Format: minute hour day month weekday
          </p>
        </div>
      )}

      <div className="text-xs text-gray-600">
        {CRON_PRESETS.find((p) => p.value === value)?.description ||
          (isCustom ? "Custom schedule" : "")}
      </div>
    </div>
  );
}

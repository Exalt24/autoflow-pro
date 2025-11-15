import { CronExpressionParser } from "cron-parser";

export interface CronPreset {
  label: string;
  value: string;
  description: string;
}

export const CRON_PRESETS: CronPreset[] = [
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

export function validateCronExpression(expression: string): {
  valid: boolean;
  error?: string;
} {
  try {
    CronExpressionParser.parse(expression);
    return { valid: true };
  } catch (error: any) {
    return { valid: false, error: error.message };
  }
}

export function getNextRunTime(
  cronExpression: string,
  currentDate?: Date
): Date {
  const interval = CronExpressionParser.parse(cronExpression, {
    currentDate: currentDate || new Date(),
  });
  return interval.next().toDate();
}

export function getNextNRunTimes(
  cronExpression: string,
  count: number,
  currentDate?: Date
): Date[] {
  const times: Date[] = [];
  const interval = CronExpressionParser.parse(cronExpression, {
    currentDate: currentDate || new Date(),
  });

  for (let i = 0; i < count; i++) {
    times.push(interval.next().toDate());
  }

  return times;
}

export function getCronDescription(cronExpression: string): string {
  const parts = cronExpression.split(" ");
  if (parts.length !== 5) return "Invalid cron expression";

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  if (cronExpression === "* * * * *") return "Every minute";
  if (cronExpression === "0 * * * *") return "Every hour";
  if (cronExpression === "0 0 * * *") return "Every day at midnight";
  if (cronExpression.startsWith("*/")) {
    const interval = minute.substring(2);
    return `Every ${interval} minutes`;
  }
  if (minute === "0" && hour !== "*") {
    return `Every day at ${hour.padStart(2, "0")}:00`;
  }

  const preset = CRON_PRESETS.find((p) => p.value === cronExpression);
  return preset ? preset.description : "Custom schedule";
}

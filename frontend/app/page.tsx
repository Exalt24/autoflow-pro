import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-dark-bg p-4">
      <div className="text-center max-w-4xl">
        <h1 className="text-6xl font-bold mb-4 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
          AutoFlow Pro
        </h1>
        <p className="text-xl text-gray-300 mb-8">
          Professional Browser Automation Platform
        </p>

        <div className="flex gap-4 justify-center mb-12">
          <Link
            href="/signup"
            className="bg-primary hover:bg-primary/90 text-white px-6 py-3 rounded-md font-medium transition"
          >
            Get Started
          </Link>
          <Link
            href="/login"
            className="bg-dark-card hover:bg-dark-card/80 text-white px-6 py-3 rounded-md font-medium border border-dark-border transition"
          >
            Sign In
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
          <div className="bg-dark-card p-6 rounded-lg border border-dark-border">
            <h3 className="text-xl font-semibold text-white mb-2">
              Visual Workflow Builder
            </h3>
            <p className="text-gray-400">
              Create automation workflows with an intuitive drag-and-drop
              interface
            </p>
          </div>

          <div className="bg-dark-card p-6 rounded-lg border border-dark-border">
            <h3 className="text-xl font-semibold text-white mb-2">
              Real-time Monitoring
            </h3>
            <p className="text-gray-400">
              Track execution progress with live updates and detailed logs
            </p>
          </div>

          <div className="bg-dark-card p-6 rounded-lg border border-dark-border">
            <h3 className="text-xl font-semibold text-white mb-2">
              Scheduled Automation
            </h3>
            <p className="text-gray-400">
              Schedule workflows to run automatically with cron expressions
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

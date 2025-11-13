export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-6xl font-bold mb-4 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            AutoFlow Pro
          </h1>
          <p className="text-xl text-gray-400">
            Browser Automation Platform - Phase 0 Setup Complete
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="bg-dark-card border border-dark-border rounded-lg p-6 hover:border-primary transition-colors">
            <div className="text-3xl mb-3">🚀</div>
            <h3 className="text-lg font-semibold mb-2">Next.js 15</h3>
            <p className="text-gray-400 text-sm">
              Latest App Router with React 19 and Server Actions
            </p>
          </div>

          <div className="bg-dark-card border border-dark-border rounded-lg p-6 hover:border-secondary transition-colors">
            <div className="text-3xl mb-3">⚡</div>
            <h3 className="text-lg font-semibold mb-2">Tailwind CSS 4</h3>
            <p className="text-gray-400 text-sm">
              CSS-first configuration with custom theme
            </p>
          </div>

          <div className="bg-dark-card border border-dark-border rounded-lg p-6 hover:border-success transition-colors">
            <div className="text-3xl mb-3">🤖</div>
            <h3 className="text-lg font-semibold mb-2">Playwright</h3>
            <p className="text-gray-400 text-sm">
              Browser automation with Chromium, Firefox, WebKit
            </p>
          </div>
        </div>

        <div className="bg-success/10 border border-success/30 rounded-lg p-6 text-center">
          <p className="text-success font-semibold mb-2">
            ✓ Frontend Setup Complete
          </p>
          <p className="text-sm text-gray-400">
            Next.js development server running with Turbopack
          </p>
        </div>
      </div>
    </div>
  );
}

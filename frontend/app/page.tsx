import Link from "next/link";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/Card";
import { Workflow, Zap, BarChart3 } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-linear-to-br from-primary/10 via-secondary/5 to-primary/10">
      <nav className="border-b bg-white/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-2xl font-bold bg-linear-to-r from-primary to-secondary bg-clip-text text-transparent">
              AutoFlow Pro
            </h1>
            <div className="flex gap-3">
              <Link href="/login">
                <Button variant="ghost">Sign In</Button>
              </Link>
              <Link href="/signup">
                <Button>Get Started</Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-16">
          <h2 className="text-5xl font-bold mb-6 bg-linear-to-r from-primary via-secondary to-primary bg-clip-text text-transparent">
            Browser Automation Made Simple
          </h2>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            Create powerful browser automation workflows with our visual
            builder. No coding required.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/signup">
              <Button size="lg">Start Free Trial</Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline">
                Sign In
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8 mt-20">
          <Card>
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Workflow className="w-6 h-6 text-primary" />
              </div>
              <CardTitle>Visual Workflow Builder</CardTitle>
              <CardDescription>
                Drag and drop to create automation workflows
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Build complex automation workflows with our intuitive visual
                builder. Connect steps, add conditions, and create loops without
                writing code.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-secondary/10 flex items-center justify-center mb-4">
                <Zap className="w-6 h-6 text-secondary" />
              </div>
              <CardTitle>Real-time Execution</CardTitle>
              <CardDescription>
                Watch your workflows run in real-time
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Monitor execution progress with live logs and screenshots. Get
                instant feedback and debug issues as they happen.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-success/10 flex items-center justify-center mb-4">
                <BarChart3 className="w-6 h-6 text-success" />
              </div>
              <CardTitle>Analytics Dashboard</CardTitle>
              <CardDescription>
                Track performance and usage metrics
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Comprehensive analytics showing execution success rates, average
                duration, and usage patterns. Optimize your workflows with data.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>

      <footer className="border-t mt-20 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-sm text-gray-600">
          <p>&copy; 2026 AutoFlow Pro. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

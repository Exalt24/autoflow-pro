-- AutoFlow Pro Complete Database Schema
-- Run this ONCE in Supabase SQL Editor

-- Clean slate
DROP TABLE IF EXISTS execution_logs CASCADE;
DROP TABLE IF EXISTS scheduled_jobs CASCADE;
DROP TABLE IF EXISTS executions CASCADE;
DROP TABLE IF EXISTS usage_quotas CASCADE;
DROP TABLE IF EXISTS workflows CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

DROP POLICY IF EXISTS "Users upload own workflow attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users read own workflow attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own workflow attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users upload own screenshots" ON storage.objects;
DROP POLICY IF EXISTS "Users read own screenshots" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own screenshots" ON storage.objects;

DELETE FROM storage.buckets WHERE id IN ('workflow-attachments', 'execution-screenshots');

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tables
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration INTEGER,
  logs JSONB DEFAULT '[]'::jsonb,
  extracted_data JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  r2_key TEXT
);

CREATE TABLE scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cron_schedule TEXT NOT NULL,
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE usage_quotas (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  workflows_count INTEGER NOT NULL DEFAULT 0,
  executions_count INTEGER NOT NULL DEFAULT 0,
  executions_limit INTEGER NOT NULL DEFAULT 50,
  storage_used BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE execution_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message TEXT NOT NULL,
  step_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX idx_workflows_user_id ON workflows(user_id);
CREATE INDEX idx_workflows_status ON workflows(status);
CREATE INDEX idx_workflows_user_created ON workflows(user_id, created_at DESC);
CREATE INDEX idx_executions_workflow_id ON executions(workflow_id);
CREATE INDEX idx_executions_user_id ON executions(user_id);
CREATE INDEX idx_executions_status ON executions(status);
CREATE INDEX idx_executions_user_started ON executions(user_id, started_at DESC);
CREATE INDEX idx_executions_archived ON executions(archived) WHERE archived = FALSE;
CREATE INDEX idx_scheduled_jobs_user_id ON scheduled_jobs(user_id);
CREATE INDEX idx_scheduled_jobs_next_run ON scheduled_jobs(next_run_at) WHERE is_active = TRUE;
CREATE INDEX idx_scheduled_jobs_workflow_id ON scheduled_jobs(workflow_id);
CREATE INDEX idx_execution_logs_execution_id ON execution_logs(execution_id);
CREATE INDEX idx_execution_logs_timestamp ON execution_logs(timestamp DESC);

-- RLS
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own workflows" ON workflows FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own workflows" ON workflows FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own workflows" ON workflows FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own workflows" ON workflows FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own executions" ON executions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own executions" ON executions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own executions" ON executions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own executions" ON executions FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own scheduled jobs" ON scheduled_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own scheduled jobs" ON scheduled_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own scheduled jobs" ON scheduled_jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own scheduled jobs" ON scheduled_jobs FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own usage quotas" ON usage_quotas FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own usage quotas" ON usage_quotas FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view logs for their own executions" ON execution_logs FOR SELECT 
  USING (EXISTS (SELECT 1 FROM executions WHERE executions.id = execution_logs.execution_id AND executions.user_id = auth.uid()));
CREATE POLICY "Users can create logs for their own executions" ON execution_logs FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM executions WHERE executions.id = execution_logs.execution_id AND executions.user_id = auth.uid()));

-- Triggers
CREATE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_workflows_updated_at BEFORE UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_scheduled_jobs_updated_at BEFORE UPDATE ON scheduled_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_usage_quotas_updated_at BEFORE UPDATE ON usage_quotas FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Storage Buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('workflow-attachments', 'workflow-attachments', false, 10485760, NULL),
  ('execution-screenshots', 'execution-screenshots', false, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp']);

-- Storage Policies
CREATE POLICY "Users upload own workflow attachments" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'workflow-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users read own workflow attachments" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'workflow-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own workflow attachments" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'workflow-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users upload own screenshots" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'execution-screenshots' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users read own screenshots" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'execution-screenshots' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own screenshots" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'execution-screenshots' AND auth.uid()::text = (storage.foldername(name))[1]);
-- AutoFlow Pro Complete Database Schema with Performance Optimizations
-- Run this in Supabase SQL Editor (idempotent - safe to re-run)
-- WARNING: This deletes ALL users and data - only use for testing/development!

-- Delete all users first (CASCADE will clean up related data)
DELETE FROM auth.users;

-- Clean slate - Drop everything
DROP TABLE IF EXISTS execution_logs CASCADE;
DROP TABLE IF EXISTS scheduled_jobs CASCADE;
DROP TABLE IF EXISTS executions CASCADE;
DROP TABLE IF EXISTS usage_quotas CASCADE;
DROP TABLE IF EXISTS workflows CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS get_execution_trends CASCADE;
DROP FUNCTION IF EXISTS get_workflow_usage CASCADE;

-- Drop storage policies
DROP POLICY IF EXISTS "Users upload own workflow attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users read own workflow attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own workflow attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users upload own screenshots" ON storage.objects;
DROP POLICY IF EXISTS "Users read own screenshots" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own screenshots" ON storage.objects;

-- Delete objects first (foreign key constraint), then buckets
DELETE FROM storage.objects WHERE bucket_id IN ('workflow-attachments', 'execution-screenshots');
DELETE FROM storage.buckets WHERE id IN ('workflow-attachments', 'execution-screenshots');

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

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
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days IN (7, 30, 90)),
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

-- Indexes (Original + Performance Optimizations)
CREATE INDEX idx_workflows_user_id ON workflows(user_id);
CREATE INDEX idx_workflows_status ON workflows(status);
CREATE INDEX idx_workflows_user_created ON workflows(user_id, created_at DESC);
CREATE INDEX idx_workflows_name_trgm ON workflows USING gin (name gin_trgm_ops);
CREATE INDEX idx_workflows_description_trgm ON workflows USING gin (description gin_trgm_ops);

CREATE INDEX idx_executions_workflow_id ON executions(workflow_id);
CREATE INDEX idx_executions_user_id ON executions(user_id);
CREATE INDEX idx_executions_status ON executions(status);
CREATE INDEX idx_executions_user_started ON executions(user_id, started_at DESC);
CREATE INDEX idx_executions_archived ON executions(archived) WHERE archived = FALSE;
CREATE INDEX idx_executions_started_at ON executions(started_at DESC);
CREATE INDEX idx_executions_user_started_active ON executions(user_id, started_at DESC) WHERE archived = FALSE;
CREATE INDEX idx_executions_workflow_user ON executions(workflow_id, user_id) WHERE archived = FALSE;

CREATE INDEX idx_scheduled_jobs_user_id ON scheduled_jobs(user_id);
CREATE INDEX idx_scheduled_jobs_next_run ON scheduled_jobs(next_run_at) WHERE is_active = TRUE;
CREATE INDEX idx_scheduled_jobs_workflow_id ON scheduled_jobs(workflow_id);

CREATE INDEX idx_usage_quotas_retention ON usage_quotas(user_id, retention_days);

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

-- Performance SQL Functions
CREATE OR REPLACE FUNCTION get_execution_trends(
  p_user_id UUID,
  p_days INTEGER,
  p_start_date TIMESTAMPTZ
)
RETURNS TABLE (
  date TEXT,
  total BIGINT,
  successful BIGINT,
  failed BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE(started_at)::TEXT AS date,
    COUNT(*)::BIGINT AS total,
    COUNT(*) FILTER (WHERE status = 'completed')::BIGINT AS successful,
    COUNT(*) FILTER (WHERE status = 'failed')::BIGINT AS failed
  FROM executions
  WHERE
    user_id = p_user_id
    AND started_at >= p_start_date
  GROUP BY DATE(started_at)
  ORDER BY DATE(started_at) ASC;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION get_workflow_usage(
  p_user_id UUID,
  p_limit INTEGER
)
RETURNS TABLE (
  workflow_id UUID,
  workflow_name TEXT,
  execution_count BIGINT,
  success_rate NUMERIC,
  average_duration NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    w.id AS workflow_id,
    w.name AS workflow_name,
    COUNT(e.id)::BIGINT AS execution_count,
    ROUND(
      (COUNT(e.id) FILTER (WHERE e.status = 'completed')::NUMERIC / NULLIF(COUNT(e.id), 0)::NUMERIC) * 100,
      2
    ) AS success_rate,
    ROUND(AVG(e.duration)::NUMERIC, 2) AS average_duration
  FROM workflows w
  LEFT JOIN executions e ON e.workflow_id = w.id AND e.archived = FALSE
  WHERE w.user_id = p_user_id
  GROUP BY w.id, w.name
  HAVING COUNT(e.id) > 0
  ORDER BY COUNT(e.id) DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_execution_trends TO authenticated;
GRANT EXECUTE ON FUNCTION get_workflow_usage TO authenticated;

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

-- Comments for documentation
COMMENT ON INDEX idx_executions_started_at IS 'Optimizes date range queries and trends';
COMMENT ON INDEX idx_executions_user_started_active IS 'Covering index for active user execution lists';
COMMENT ON INDEX idx_executions_workflow_user IS 'Optimizes workflow-specific queries';
COMMENT ON INDEX idx_workflows_name_trgm IS 'Enables fast fuzzy text search on workflow names';
COMMENT ON INDEX idx_workflows_description_trgm IS 'Enables fast fuzzy text search on workflow descriptions';
COMMENT ON COLUMN usage_quotas.retention_days IS 'Number of days to retain execution data before archival (7, 30, or 90 days)';
COMMENT ON FUNCTION get_execution_trends IS 'SQL aggregation for execution trends - replaces JavaScript processing';
COMMENT ON FUNCTION get_workflow_usage IS 'SQL aggregation for workflow analytics - replaces JavaScript processing';
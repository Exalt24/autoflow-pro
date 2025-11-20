# AutoFlow Pro - Go-Live Checklist

## Pre-Deployment Verification

### Code Quality

- [ ] All TypeScript errors resolved
- [ ] ESLint warnings addressed
- [ ] No console.log in production code (use logger)
- [ ] All tests passing locally
- [ ] Code reviewed and approved

### Security

- [ ] No hardcoded credentials in code
- [ ] Environment variables properly configured
- [ ] Security headers enabled (@fastify/helmet)
- [ ] Input sanitization implemented
- [ ] Rate limiting configured (100 req/15min)
- [ ] CORS properly configured
- [ ] Row Level Security enabled in Supabase

### Documentation

- [ ] README.md updated with production URLs
- [ ] API documentation complete
- [ ] User guide reviewed
- [ ] Deployment guide verified
- [ ] Troubleshooting guide comprehensive

---

## Infrastructure Setup

### Supabase

- [ ] Project created (Singapore region)
- [ ] Database schema deployed
- [ ] Row Level Security policies active
- [ ] Storage buckets created:
  - [ ] workflow-attachments
  - [ ] execution-screenshots
- [ ] Real-time enabled on executions and execution_logs
- [ ] Authentication configured (Email/Password)
- [ ] Production credentials secured

### Upstash Redis

- [ ] Database created (Singapore region)
- [ ] Connection string copied
- [ ] 10K commands/day limit understood

### Cloudflare R2

- [ ] Bucket created: autoflow-archives
- [ ] API tokens generated
- [ ] Credentials secured

### GitHub

- [ ] Repository up to date
- [ ] All changes committed and pushed
- [ ] Branch protection rules set (optional)
- [ ] Secrets configured for GitHub Actions

---

## Deployment

### Backend (Render)

- [ ] Service created
- [ ] Region: Singapore
- [ ] Runtime: Node
- [ ] Build command: `npm install && npm run build`
- [ ] Start command: `npm start`
- [ ] Health check path: `/health`
- [ ] Environment variables configured:
  - [ ] NODE_ENV=production
  - [ ] PORT=4000
  - [ ] SUPABASE_URL
  - [ ] SUPABASE_ANON_KEY
  - [ ] SUPABASE_SERVICE_KEY
  - [ ] UPSTASH_REDIS_URL
  - [ ] CLOUDFLARE*R2*\*
  - [ ] CORS_ORIGIN (Vercel URL)
- [ ] Auto-deploy enabled
- [ ] First deployment successful
- [ ] Health check returns 200

### Frontend (Vercel)

- [ ] Project imported
- [ ] Framework: Next.js
- [ ] Root directory: frontend
- [ ] Environment variables configured:
  - [ ] NEXT_PUBLIC_API_URL
  - [ ] NEXT_PUBLIC_WS_URL
  - [ ] NEXT_PUBLIC_SUPABASE_URL
  - [ ] NEXT_PUBLIC_SUPABASE_ANON_KEY
- [ ] First deployment successful
- [ ] Site accessible

### Cross-Service Configuration

- [ ] Backend CORS_ORIGIN updated with Vercel URL
- [ ] Supabase Site URL set to Vercel URL
- [ ] Supabase Redirect URLs added

---

## Monitoring

### UptimeRobot

- [ ] Account created
- [ ] Monitor configured:
  - [ ] Type: HTTP(s)
  - [ ] URL: Backend /health endpoint
  - [ ] Interval: 5 minutes
- [ ] Alert contacts added
- [ ] Email verified
- [ ] First check successful

### GitHub Actions (Optional)

- [ ] Secrets configured:
  - [ ] VERCEL_TOKEN
  - [ ] VERCEL_ORG_ID
  - [ ] VERCEL_PROJECT_ID
  - [ ] RENDER_API_KEY
  - [ ] RENDER_SERVICE_ID
  - [ ] BACKEND_URL
  - [ ] FRONTEND_URL
- [ ] Workflows enabled
- [ ] First workflow run successful

---

## Testing

### Smoke Tests

Run locally first:

```bash
cd autoflow-pro
npx tsx scripts/smoke-test.ts
```

Expected: All tests pass

### Production Verification

```bash
npx tsx scripts/verify-production.ts
```

Expected: All checks pass (warnings acceptable)

### End-to-End Testing

#### 1. Authentication Flow

- [ ] Visit frontend URL
- [ ] Click "Sign Up"
- [ ] Create test account
- [ ] Verify email (if required)
- [ ] Log in successfully
- [ ] See dashboard

#### 2. Workflow Creation

- [ ] Navigate to Workflows page
- [ ] Click "Create Workflow"
- [ ] Enter name: "Test Workflow"
- [ ] Add navigate step: https://example.com
- [ ] Add extract step: h1 text
- [ ] Save workflow
- [ ] Workflow appears in list

#### 3. Workflow Execution

- [ ] Click "Execute" button
- [ ] Navigate to Executions page
- [ ] See execution with "Queued" status
- [ ] Status changes to "Running"
- [ ] Live logs stream in real-time
- [ ] Status changes to "Completed"
- [ ] Extracted data visible
- [ ] Duration displayed

#### 4. Real-Time Features

- [ ] WebSocket connection established (check browser console)
- [ ] Green "Live" indicator visible during execution
- [ ] Logs auto-scroll
- [ ] No console errors

#### 5. Scheduled Jobs

- [ ] Navigate to Scheduled Jobs page
- [ ] Click "Schedule Workflow"
- [ ] Select test workflow
- [ ] Set schedule: Daily at 9:00 AM
- [ ] Preview shows next run time
- [ ] Create scheduled job
- [ ] Job appears in list with next run time

#### 6. Analytics Dashboard

- [ ] Navigate to Analytics page
- [ ] All charts load without errors
- [ ] Execution volume chart shows data
- [ ] Success rate displays correctly
- [ ] Resource usage shows metrics
- [ ] Time range selector works

#### 7. Visual Workflow Builder (Optional)

- [ ] Navigate to workflow
- [ ] Click Network icon (Visual Builder)
- [ ] Canvas loads with existing steps
- [ ] Drag node from palette
- [ ] Configure node
- [ ] Connect nodes
- [ ] Save workflow
- [ ] Changes persist

---

## Performance Verification

### Backend

- [ ] Health check responds < 200ms
- [ ] API endpoints respond < 500ms
- [ ] Database queries < 100ms (check /health/detailed)
- [ ] Memory usage < 75%
- [ ] No memory leaks (monitor over 24 hours)

### Frontend

- [ ] Initial page load < 3 seconds
- [ ] Dashboard loads < 2 seconds
- [ ] No console errors in production
- [ ] All images load
- [ ] Charts render correctly

### WebSocket

- [ ] Connection establishes < 1 second
- [ ] Messages receive < 100ms latency
- [ ] Reconnection works after disconnect
- [ ] No connection leaks

---

## Security Verification

### Headers

Check with browser DevTools (Network tab):

- [ ] X-Content-Type-Options: nosniff
- [ ] X-Frame-Options: DENY
- [ ] X-XSS-Protection: 1; mode=block
- [ ] Strict-Transport-Security (HTTPS only)
- [ ] Access-Control-Allow-Origin (correct origin)

### Authentication

- [ ] Protected routes redirect to login
- [ ] Invalid tokens rejected (401)
- [ ] Users can only access own data
- [ ] Service role key not exposed
- [ ] Logout works correctly

### Input Validation

Test with invalid inputs:

- [ ] Empty workflow name rejected
- [ ] Invalid UUID rejected
- [ ] Invalid cron expression rejected
- [ ] XSS attempts blocked
- [ ] SQL injection attempts blocked

### Rate Limiting

Send 101 requests in < 15 minutes:

- [ ] 101st request returns 429
- [ ] Error message: "Rate limit exceeded"
- [ ] Retry-After header present

---

## Data Verification

### Database

- [ ] All tables accessible
- [ ] RLS policies enforced
- [ ] Indexes created
- [ ] Triggers active
- [ ] Foreign keys enforced

### Storage

- [ ] Workflow attachments upload
- [ ] Screenshots upload
- [ ] File size limits enforced
- [ ] RLS policies work (can't access other users' files)

### Archival

- [ ] R2 bucket accessible
- [ ] Test archival works (run manually)
- [ ] Archived data retrievable
- [ ] Retention policy configurable

---

## Resource Limits

### Verify Free Tier Limits

- [ ] Workflows: 10 max enforced
- [ ] Executions: 50/month tracked
- [ ] Storage: 1GB limit enforced
- [ ] Execution time: 15 min timeout enforced

### Monitor Usage

- [ ] Resource usage card shows accurate data
- [ ] Warnings appear at 80% usage
- [ ] Critical alerts at 90% usage

---

## Operational Readiness

### Logging

- [ ] Backend logs to Render console
- [ ] Logs include request details
- [ ] Errors logged with stack traces
- [ ] Log level appropriate (info in prod)

### Monitoring

- [ ] UptimeRobot shows "Up" status
- [ ] Response times < 500ms
- [ ] Uptime > 99% after 24 hours

### Backups

- [ ] Supabase automatic backups enabled
- [ ] Point-in-time recovery available
- [ ] Manual backup taken and stored

### Disaster Recovery

- [ ] Rollback procedure documented
- [ ] Database restore tested
- [ ] Know how to restart services

---

## Post-Launch

### First 24 Hours

- [ ] Monitor UptimeRobot for downtime
- [ ] Check Render logs for errors
- [ ] Watch for performance issues
- [ ] Test all features manually

### First Week

- [ ] Review analytics daily
- [ ] Check error rates
- [ ] Monitor resource usage
- [ ] Collect user feedback

### Ongoing

- [ ] Weekly log review
- [ ] Monthly security audit
- [ ] Quarterly dependency updates
- [ ] Regular database backups

---

## Communication

### Internal

- [ ] Team notified of go-live
- [ ] Production URLs shared
- [ ] Access credentials distributed
- [ ] Support procedures documented

### External (if applicable)

- [ ] Users notified of launch
- [ ] Documentation published
- [ ] Support channels ready
- [ ] Status page configured

---

## Rollback Plan

If critical issues discovered:

1. **Immediate Actions**:

   - [ ] Document the issue
   - [ ] Capture error logs
   - [ ] Take screenshots

2. **Rollback Backend**:

   - [ ] Go to Render dashboard
   - [ ] Select previous deployment
   - [ ] Click "Deploy"

3. **Rollback Frontend**:

   - [ ] Go to Vercel dashboard
   - [ ] Find working deployment
   - [ ] Click "Promote to Production"

4. **Post-Rollback**:
   - [ ] Verify services operational
   - [ ] Notify stakeholders
   - [ ] Document root cause
   - [ ] Plan fix and redeployment

---

## Sign-Off

### Technical Lead

- [ ] All technical requirements met
- [ ] Performance targets achieved
- [ ] Security measures verified
- [ ] Monitoring in place

**Signature**: ********\_******** **Date**: ****\_****

### Product Owner

- [ ] All features functional
- [ ] User experience acceptable
- [ ] Documentation complete
- [ ] Ready for production traffic

**Signature**: ********\_******** **Date**: ****\_****

---

## Go-Live Decision

**Status**: [ ] Approved [ ] Rejected [ ] Needs Review

**Go-Live Date**: ********\_********

**Go-Live Time**: ********\_******** (UTC+8 for Philippines)

**Approved By**: ********\_********

**Notes**:

---

---

---

---

## Post-Launch Monitoring

**First 24 Hours Checklist**:

- [ ] Hour 1: Check health endpoints
- [ ] Hour 4: Review first executions
- [ ] Hour 8: Check error rates
- [ ] Hour 24: Full system review

**Issue Log**:
| Time | Issue | Severity | Status | Resolution |
|------|-------|----------|--------|------------|
| | | | | |

---

**✅ GO-LIVE APPROVED - DEPLOY TO PRODUCTION**

# AutoFlow Pro Deployment Guide

## Prerequisites

- GitHub account
- Vercel account (free tier)
- Render account (free tier)
- Supabase account (free tier)
- Upstash account (free tier)
- Cloudflare account (free tier - for R2)

---

## Step 1: Supabase Setup

### 1.1 Create Project

1. Go to https://supabase.com
2. Click "New Project"
3. Choose organization
4. Enter project details:
   - Name: `autoflow-pro`
   - Database Password: Generate strong password
   - Region: **Singapore** (closest to Philippines)
5. Click "Create new project"
6. Wait 2-3 minutes for setup

### 1.2 Run Database Schema

1. Go to **SQL Editor**
2. Open `backend/migrations/initial_schema.sql` from your repository
3. Copy entire contents
4. Paste into SQL Editor
5. Click **"Run"**
6. Verify: **Tables** tab shows 6 tables created

### 1.3 Configure Real-Time

1. Go to **Database** → **Replication**
2. Enable replication for:
   - `executions` table
   - `execution_logs` table
3. Click **"Save"**

### 1.4 Copy Credentials

Go to **Settings** → **API**:

- Copy **Project URL** (save as `SUPABASE_URL`)
- Copy **anon public** key (save as `SUPABASE_ANON_KEY`)
- Copy **service_role** key (save as `SUPABASE_SERVICE_KEY`)

⚠️ **Keep service_role key secure** - it bypasses Row Level Security

---

## Step 2: Upstash Redis Setup

### 2.1 Create Database

1. Go to https://upstash.com
2. Click **"Create Database"**
3. Enter name: `autoflow-queue`
4. Region: **Singapore** (ap-southeast-1)
5. Type: Regional
6. Click **"Create"**

### 2.2 Copy Connection String

1. Click on database
2. Go to **Details** tab
3. Copy **REST URL** (save as `UPSTASH_REDIS_URL`)
4. Format: `rediss://default:password@host:6379`

---

## Step 3: Cloudflare R2 Setup

### 3.1 Create Bucket

1. Go to https://dash.cloudflare.com
2. Navigate to **R2** in sidebar
3. Click **"Create bucket"**
4. Name: `autoflow-archives`
5. Location: **Automatic** (or choose Singapore if available)
6. Click **"Create bucket"**

### 3.2 Create API Token

1. Go to **R2** → **Manage R2 API Tokens**
2. Click **"Create API token"**
3. Token name: `autoflow-prod`
4. Permissions: **Object Read & Write**
5. Click **"Create API token"**
6. Copy credentials:
   - Access Key ID (save as `CLOUDFLARE_R2_ACCESS_KEY_ID`)
   - Secret Access Key (save as `CLOUDFLARE_R2_SECRET_ACCESS_KEY`)
   - Account ID from URL (save as `CLOUDFLARE_R2_ACCOUNT_ID`)

---

## Step 4: Push to GitHub

### 4.1 Create Repository

```powershell
cd autoflow-pro

# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - production ready"

# Create repo on GitHub (via web interface)
# Then add remote and push:
git remote add origin https://github.com/YOUR_USERNAME/autoflow-pro.git
git branch -M main
git push -u origin main
```

---

## Step 5: Deploy Backend to Render

### 5.1 Create Web Service

1. Go to https://render.com
2. Click **"New +"** → **"Web Service"**
3. Connect GitHub account
4. Select `autoflow-pro` repository
5. Configure service:
   - **Name**: `autoflow-pro-api`
   - **Region**: **Singapore**
   - **Branch**: `main`
   - **Root Directory**: `backend`
   - **Runtime**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free

### 5.2 Add Environment Variables

Click **"Advanced"** → **"Add Environment Variable"**:

| Key                               | Value                                          |
| --------------------------------- | ---------------------------------------------- |
| `NODE_ENV`                        | `production`                                   |
| `PORT`                            | `4000`                                         |
| `SUPABASE_URL`                    | Your Supabase URL                              |
| `SUPABASE_ANON_KEY`               | Your anon key                                  |
| `SUPABASE_SERVICE_KEY`            | Your service key                               |
| `UPSTASH_REDIS_URL`               | Your Redis URL                                 |
| `CLOUDFLARE_R2_ACCOUNT_ID`        | Your account ID                                |
| `CLOUDFLARE_R2_ACCESS_KEY_ID`     | Your access key                                |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | Your secret key                                |
| `CLOUDFLARE_R2_BUCKET_NAME`       | `autoflow-archives`                            |
| `CORS_ORIGIN`                     | Leave empty for now (will update after Vercel) |

### 5.3 Deploy

1. Click **"Create Web Service"**
2. Wait 5-10 minutes for build and deploy
3. Once deployed, copy the URL (e.g., `https://autoflow-pro-api.onrender.com`)
4. Test health endpoint: Visit `https://your-url.onrender.com/health`
5. Should see: `{"status":"healthy",...}`

### 5.4 Update CORS_ORIGIN

1. Go back to Render dashboard
2. Click your service → **Environment**
3. Edit `CORS_ORIGIN` (will add Vercel URL after next step)

---

## Step 6: Deploy Frontend to Vercel

### 6.1 Import Project

1. Go to https://vercel.com
2. Click **"Add New..."** → **"Project"**
3. Import `autoflow-pro` repository
4. Configure:
   - **Framework Preset**: Next.js
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`
   - **Install Command**: `npm install`

### 6.2 Add Environment Variables

Click **"Environment Variables"**:

| Key                             | Value                                   |
| ------------------------------- | --------------------------------------- |
| `NEXT_PUBLIC_API_URL`           | `https://your-backend.onrender.com/api` |
| `NEXT_PUBLIC_WS_URL`            | `https://your-backend.onrender.com`     |
| `NEXT_PUBLIC_SUPABASE_URL`      | Your Supabase URL                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your anon key                           |

### 6.3 Deploy

1. Click **"Deploy"**
2. Wait 2-5 minutes for build
3. Once deployed, copy the URL (e.g., `https://autoflow-pro.vercel.app`)

### 6.4 Update Backend CORS

1. Go back to Render dashboard
2. Navigate to your backend service → **Environment**
3. Edit `CORS_ORIGIN` variable
4. Set to: `https://your-frontend.vercel.app`
5. Service will auto-redeploy

---

## Step 7: Configure Supabase Auth

### 7.1 Update Site URL

1. Go to Supabase project → **Authentication** → **URL Configuration**
2. Set **Site URL**: `https://your-frontend.vercel.app`
3. Add **Redirect URLs**:
   - `https://your-frontend.vercel.app/auth/callback`
   - `https://your-frontend.vercel.app/dashboard`
4. Click **"Save"**

### 7.2 Configure Email Templates (Optional)

1. Go to **Authentication** → **Email Templates**
2. Customize confirmation and recovery emails
3. Update links to point to your Vercel domain

---

## Step 8: Setup UptimeRobot Monitoring

### 8.1 Create Monitor

1. Go to https://uptimerobot.com
2. Sign up / Log in
3. Click **"Add New Monitor"**
4. Configure:
   - **Monitor Type**: HTTP(s)
   - **Friendly Name**: AutoFlow Pro API
   - **URL**: `https://your-backend.onrender.com/health`
   - **Monitoring Interval**: 5 minutes
5. Click **"Create Monitor"**

### 8.2 Add Alert Contacts

1. Go to **"My Settings"** → **"Alert Contacts"**
2. Add your email
3. Verify email
4. Enable notifications for new monitor

**Why 5 minutes?** Prevents Render free tier from spinning down (inactive after 15 minutes).

---

## Step 9: Configure GitHub Actions (Optional)

### 9.1 Get Vercel Tokens

1. Go to Vercel → **Settings** → **Tokens**
2. Create new token: `github-actions`
3. Copy token (save as `VERCEL_TOKEN`)

4. Go to your project → **Settings** → **General**
5. Copy **Project ID** (save as `VERCEL_PROJECT_ID`)
6. Copy **Org ID** from URL or settings (save as `VERCEL_ORG_ID`)

### 9.2 Get Render API Key

1. Go to Render → **Account Settings** → **API Keys**
2. Create new key: `github-actions`
3. Copy key (save as `RENDER_API_KEY`)
4. Copy **Service ID** from your service URL (save as `RENDER_SERVICE_ID`)

### 9.3 Add GitHub Secrets

1. Go to GitHub repository → **Settings** → **Secrets and variables** → **Actions**
2. Click **"New repository secret"** for each:

| Secret Name                     | Value                |
| ------------------------------- | -------------------- |
| `VERCEL_TOKEN`                  | Your Vercel token    |
| `VERCEL_ORG_ID`                 | Your org ID          |
| `VERCEL_PROJECT_ID`             | Your project ID      |
| `RENDER_API_KEY`                | Your Render API key  |
| `RENDER_SERVICE_ID`             | Your service ID      |
| `BACKEND_URL`                   | Your backend URL     |
| `NEXT_PUBLIC_API_URL`           | Your backend API URL |
| `NEXT_PUBLIC_WS_URL`            | Your backend WS URL  |
| `NEXT_PUBLIC_SUPABASE_URL`      | Your Supabase URL    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your anon key        |
| `SUPABASE_URL`                  | Your Supabase URL    |
| `SUPABASE_ANON_KEY`             | Your anon key        |
| `SUPABASE_SERVICE_KEY`          | Your service key     |

---

## Step 10: Verification

### 10.1 Backend Health

Visit: `https://your-backend.onrender.com/health`

Expected:

```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:00:00.000Z",
  "uptime": "5m",
  "environment": "production"
}
```

### 10.2 Frontend Access

1. Visit: `https://your-frontend.vercel.app`
2. Should see landing page
3. Click **"Sign Up"**
4. Create test account
5. Verify email (if required)
6. Log in to dashboard

### 10.3 Complete Test Flow

1. **Create Workflow**:

   - Go to Workflows page
   - Click "Create Workflow"
   - Add simple navigate step
   - Save workflow

2. **Execute Workflow**:

   - Click "Execute" button
   - Go to Executions page
   - Should see execution running
   - Wait for completion

3. **Check Logs**:

   - Click on execution
   - View real-time logs
   - Verify WebSocket connection (green dot)

4. **Schedule Job**:

   - Go to Scheduled Jobs
   - Click "Schedule Workflow"
   - Set daily schedule
   - Verify next run time

5. **View Analytics**:
   - Go to Analytics
   - Check all charts load
   - Verify metrics accurate

### 10.4 Render Logs

1. Go to Render dashboard
2. Click your service → **Logs**
3. Should see:
   - Server started
   - Supabase connected
   - WebSocket initialized
   - Scheduler started

---

## Post-Deployment Checklist

- [ ] Backend health check returns 200
- [ ] Frontend loads without errors
- [ ] User can sign up and log in
- [ ] Workflows can be created
- [ ] Workflows execute successfully
- [ ] WebSocket real-time updates work
- [ ] Scheduled jobs create and run
- [ ] Analytics display correctly
- [ ] UptimeRobot monitor shows "Up"
- [ ] GitHub Actions workflows pass (if configured)

---

## Updating Production

### Frontend Updates

1. Push changes to `main` branch
2. Vercel auto-deploys in ~2 minutes
3. Visit site to verify changes

### Backend Updates

1. Push changes to `main` branch
2. Render auto-deploys in ~5 minutes
3. Check logs for errors
4. Visit `/health` to verify

### Manual Deployment

**Vercel**:

1. Go to project → **Deployments**
2. Click **"Redeploy"** on latest

**Render**:

1. Go to service → **Manual Deploy**
2. Click **"Deploy latest commit"**

---

## Rollback Procedure

### Vercel Rollback

1. Go to project → **Deployments**
2. Find working deployment
3. Click **"..."** → **"Promote to Production"**

### Render Rollback

1. Go to service → **Manual Deploy**
2. Select previous commit
3. Click **"Deploy"**

---

## Cost Breakdown (Free Tier)

| Service       | Free Tier                               | Usage            |
| ------------- | --------------------------------------- | ---------------- |
| Vercel        | 100GB bandwidth, unlimited sites        | Frontend hosting |
| Render        | 750 hours/month, spins down after 15min | Backend API      |
| Supabase      | 500MB DB, 2GB bandwidth, 50K MAU        | Database & Auth  |
| Upstash       | 10K commands/day                        | Redis queue      |
| Cloudflare R2 | 10GB storage, 1M reads                  | Archival         |
| UptimeRobot   | 50 monitors, 5min interval              | Monitoring       |

**Total Monthly Cost**: $0

---

## Troubleshooting Deployment

See **TROUBLESHOOTING.md** for detailed solutions.

**Common Issues**:

1. **Build fails on Render**: Check build logs, verify Node version
2. **Frontend can't connect to backend**: Verify CORS_ORIGIN matches
3. **Database connection fails**: Check Supabase credentials
4. **Redis connection fails**: Verify Upstash URL format
5. **WebSocket doesn't connect**: Check NEXT_PUBLIC_WS_URL

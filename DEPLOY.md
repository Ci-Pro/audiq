# Audiq — Deployment Guide (Free Stack)

## 🏗️ Architecture

```
┌──────────────────────────────────────┐
│     VERCEL (Frontend + API Proxy)    │  ← GRATIS
│  Next.js App + Prisma Client         │
│  https://audiq.vercel.app           │
└──────────┬──────────────────────────┘
           │ fetchWorker() → WORKER_URL
     ┌─────▼──────────────┐
     │  SNAPDEPLOY (Worker)│  ← GRATIS
     │  yt-dlp + Bun       │
     │  Docker container    │
     │  Port (auto-inject)  │
     └──────┬──────────────┘
            │
     ┌──────▼──────────────┐
     │  NEON (Database)    │  ← GRATIS
     │  PostgreSQL          │
     │  Serverless          │
     └─────────────────────┘
```

## 📋 Step-by-Step Deployment

### STEP 1: Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/USERNAME/audiq.git
git push -u origin main
```

---

### STEP 2: Deploy ke Vercel

1. Buka **https://vercel.com**
2. Sign in dengan GitHub
3. Klik **"Add New"** → **"Project"**
4. Import repository `audiq`
5. **Configure Project**:
   - Framework Preset: **Next.js**
   - Root Directory: `.` (root)
6. Klik **"Deploy"**
7. Tunggu build selesai (~2-3 menit)
8. Website live di `https://audiq.vercel.app`

---

### STEP 3: Setup Neon Database (PostgreSQL)

1. Buka **https://console.neon.tech**
2. Sign in dengan GitHub
3. Klik **"Create Project"**
4. Isi:
   - Project name: `audiq`
   - Region: pilih yang terdekat (Singapore / Tokyo)
   - Create a branch: `main`
5. Klik **"Create project"**
6. Setelah dibuat, copy **Connection String**:
   ```
   postgresql://neondb_owner:xxxx@ep-cool-name.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
7. Tambah `DATABASE_URL` ke Vercel:
   - Buka **https://vercel.com/Ci-Pro/audiq/settings/environment-variables**
   - Add: Key = `DATABASE_URL`, Value = connection string dari Neon
   - Pilih **Production + Preview + Development**
   - Klik **Save** → Redeploy

---

### STEP 4: Deploy Worker ke SnapDeploy

1. Buka **https://snapdeploy.dev**
2. Klik **"Sign Up"** dengan GitHub (akun Ci-Pro)
   - **Tidak perlu credit card!**
3. Klik **"New Container"** → **"Deploy from GitHub"**
4. Pilih repository **Ci-Pro/audiq** → branch **main**
5. SnapDeploy akan auto-detect Dockerfile
6. ⚠️ **PENTING**: Klik **Settings** pada container:
   - **Dockerfile name**: ketik `Dockerfile.worker` (bukan Dockerfile default)
   - **Environment Variables**:
     - `WORKER_SECRET` = `audiq-secret-abc123xyz` (random string apapun)
   - Klik **Save & Restart**
7. Tunggu build selesai (~3-5 menit)
8. Copy **Container URL**, misalnya:
   ```
   https://audiq-worker-xxxx.snapdeploy.app
   ```

---

### STEP 5: Connect Worker ke Vercel

1. Buka **https://vercel.com/Ci-Pro/audiq/settings/environment-variables**
2. Tambah 2 env var:
   | Key | Value |
   |-----|-------|
   | `WORKER_URL` | URL SnapDeploy dari Step 4 |
   | `WORKER_SECRET` | Secret yang sama dengan di SnapDeploy |
3. Pilih **Production + Preview + Development**
4. Klik **Save**
5. Redeploy: Vercel Dashboard → Deployments → titik tiga → **Redeploy**

---

### STEP 6: Setup Database Schema

Jalankan migration dari lokal:

```bash
# Set DATABASE_URL ke Neon
export DATABASE_URL="postgresql://neondb_owner:xxxx@ep-xxx.aws.neon.tech/neondb?sslmode=require"

# Push schema ke Neon
npx prisma db push
```

---

## ⚠️ Important Notes (Free Tier)

### SnapDeploy Free Tier
- **No credit card required** — sign up langsung pakai GitHub
- **2 containers** gratis
- **100 jam runtime/bulan** (cukup untuk pemakaian normal)
- **Auto-sleep**: Container otomatis sleep saat tidak ada traffic
- **Auto-wake**: Container otomatis bangun saat ada request
- **Cold start**: ~20-30 detik setelah sleep
- **10 deploys/hari**

### Neon Free Tier
- **0.5 GB** storage
- **1 Project** gratis
- Auto-suspend setelah 7 hari tidak aktif (tinggal klik "Resume")

### Vercel Free Tier
- **100GB bandwidth/bulan**
- Serverless function max **10 detik** (API routes)
- **Hobby plan** (gratis)

---

## 🔄 Update Worker Secret

1. Buka SnapDeploy Dashboard → audiq-worker → Settings → Environment Variables
2. Copy value `WORKER_SECRET`
3. Buka Vercel Dashboard → audiq → Settings → Environment Variables
4. Tambah `WORKER_SECRET` dengan value yang sama
5. Redeploy: Vercel Dashboard → Deployments → Redeploy

---

## 🧪 Verifikasi

1. Buka `https://audiq.vercel.app`
2. Paste YouTube URL
3. Klik Analyze → harus muncul preview
4. Pilih format → Convert & Download
5. File harus ter-download

Kalau error "Worker not available":
- Cek WORKER_URL di Vercel env sudah benar
- Buka SnapDeploy dashboard, pastikan container status "Running"
- Kalau container sedang sleep, refresh halaman (butuh ~20s cold start)

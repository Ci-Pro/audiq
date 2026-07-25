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
     │  KOYEB (Worker)     │  ← GRATIS
     │  yt-dlp + Bun       │
     │  Docker container    │
     │  Port (auto)         │
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

### STEP 4: Deploy Worker ke Koyeb

1. Buka **https://app.koyeb.com**
2. Sign in dengan GitHub
3. Klik **"Create Service"**
4. Pilih **"GitHub"** → connect repo **Ci-Pro/audiq**
5. Settings:
   - **Branch**: `main`
   - **Root Directory**: `mini-services/download-worker`
   - **Build type**: `Dockerfile`
   - **Instance type**: **Nano** (gratis)
   - **Regions**: pilih yang terdekat (Singapore)
6. Environment Variables:
   - `WORKER_SECRET` = generate random string (contoh: `audiq-secret-xyz123`)
7. Klik **"Deploy"**
8. Tunggu build selesai (~3-5 menit)
9. Copy **Service URL** dari overview, misalnya:
   ```
   https://audiq-worker-xxxx.koyeb.app
   ```

---

### STEP 5: Connect Worker ke Vercel

1. Buka **https://vercel.com/Ci-Pro/audiq/settings/environment-variables**
2. Tambah 2 env var:
   | Key | Value |
   |-----|-------|
   | `WORKER_URL` | URL Koyeb dari Step 4 (contoh: `https://audiq-worker-xxxx.koyeb.app`) |
   | `WORKER_SECRET` | Secret yang sama dengan di Koyeb |
3. Pilih **Production + Preview + Development**
4. Klik **Save**
5. Redeploy: Vercel Dashboard → Deployments → Redeploy

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

### Koyeb Free Tier (Nano)
- **1 vCPU**, **128MB RAM**, **2GB disk**
- **Spin-down**: Service mati setelah 15 menit tidak ada request
- **Cold start**: Request pertama setelah spin-down butuh ~20 detik
- **Timeout**: Request max 5 menit
- **1 Service** gratis

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

Kalau Koyeb generate `WORKER_SECRET`, copy nilainya dari Koyeb Dashboard → Environment, lalu tambahkan ke Vercel:

1. Buka Koyeb Dashboard → audiq-worker → Environment Variables
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
- Buka Koyeb dashboard, pastikan worker status "Running"
- Kalau worker sedang spin-down, refresh halaman (butuh ~20s cold start)

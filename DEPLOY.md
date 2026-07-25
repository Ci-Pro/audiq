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
     │  ZEABUR (Worker)     │  ← GRATIS
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

### STEP 4: Deploy Worker ke Zeabur

1. Buka **https://dash.zeabur.com**
2. Sign in dengan GitHub (akun Ci-Pro)
3. Klik **"Create Project"** → kasih nama `audiq`
4. Di dalam project, klik **"Add Service"** → **"Git"**
5. Pilih repository **Ci-Pro/audiq** → branch `main`
6. Zeabur akan auto-detect Dockerfile
7. **PENTING**: Klik service yang baru terbuat → masuk ke **Settings**:
   - **Root Directory**: ketik `mini-services/download-worker`
   - **Environment Variables**: klik **"Generate"** untuk private variable:
     - `WORKER_SECRET` = `audiq-secret-abc123xyz` (atau random apapun)
8. Klik **"Deploy"**
9. Tunggu build selesai (~3-5 menit)
10. Setelah selesai, buka tab **"Networking"** → copy **Public URL**, misalnya:
    ```
    https://audiq-worker-something.zeabur.app
    ```

---

### STEP 5: Connect Worker ke Vercel

1. Buka **https://vercel.com/Ci-Pro/audiq/settings/environment-variables**
2. Tambah 2 env var:
   | Key | Value |
   |-----|-------|
   | `WORKER_URL` | URL Zeabur dari Step 4 |
   | `WORKER_SECRET` | Secret yang sama dengan di Zeabur |
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

### Zeabur Free Plan
- **No credit card required** — langsung sign up pakai GitHub
- **Resource terbatas** — cukup untuk worker kecil
- **Auto-sleep**: Service bisa sleep jika tidak ada traffic
- **Cold start**: ~20-30 detik setelah sleep
- **1 Project** gratis dengan beberapa service

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

1. Buka Zeabur Dashboard → audiq-worker → Settings → Environment Variables
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
- Buka Zeabur dashboard, pastikan worker status "Running"
- Kalau worker sedang sleep, refresh halaman (butuh ~20s cold start)

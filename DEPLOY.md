# VortexTube — Deployment Guide (Free Stack)

## 🏗️ Architecture

```
┌──────────────────────────────────────┐
│     VERCEL (Frontend + API Proxy)    │  ← GRATIS
│  Next.js App + Prisma Client         │
│  https://your-app.vercel.app        │
└──────────┬──────────────────────────┘
           │ fetchWorker() → WORKER_URL
     ┌─────▼──────────────┐
     │  RENDER (Worker)    │  ← GRATIS
     │  yt-dlp + Bun       │
     │  Port 10000          │
     │  Docker container    │
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
git remote add origin https://github.com/USERNAME/vortextube.git
git push -u origin main
```

---

### STEP 2: Setup Neon Database (PostgreSQL)

1. Buka **https://console.neon.tech**
2. Sign in dengan GitHub
3. Klik **"Create Project"**
4. Isi:
   - Project name: `vortextube`
   - Region: pilih yang terdekat (Singapore / Tokyo)
   - Create a branch: `main`
5. Klik **"Create project"**
6. Setelah dibuat, copy **Connection String**:
   ```
   postgresql://neondb_owner:xxxx@ep-cool-name.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

---

### STEP 3: Deploy Worker ke Render

1. Buka **https://render.com**
2. Sign in dengan GitHub
3. Klik **"New"** → **"Web Service"**
4. Pilih repository `vortextube`
5. Settings:
   - **Root Directory**: `mini-services/download-worker`
   - **Runtime**: Docker
   - **Plan**: Free
6. Environment Variables:
   - `PORT` = `10000`
   - `WORKER_SECRET` = generate random (klik "Generate")
7. Klik **"Create Web Service"**
8. Tunggu build selesai (~3-5 menit)
9. Copy URL worker, misalnya:
   ```
   https://vortextube-worker.onrender.com
   ```

---

### STEP 4: Deploy ke Vercel

1. Buka **https://vercel.com**
2. Sign in dengan GitHub
3. Klik **"Add New"** → **"Project"**
4. Import repository `vortextube`
5. **Configure Project**:
   - Framework Preset: **Next.js**
   - Root Directory: `.` (root)
6. **Environment Variables**:
   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | Connection string dari Neon (Step 2) |
   | `WORKER_URL` | URL dari Render (Step 3) |
   | `WORKER_SECRET` | Secret yang sama dengan di Render |
7. Klik **"Deploy"**
8. Tunggu build selesai (~2-3 menit)
9. Website live di `https://vortextube.vercel.app`

---

### STEP 5: Setup Database Schema

Setelah Vercel deploy berhasil, jalankan migration dari lokal:

```bash
# Set DATABASE_URL ke Neon
export DATABASE_URL="postgresql://neondb_owner:xxxx@ep-xxx.aws.neon.tech/neondb?sslmode=require"

# Push schema ke Neon
npx prisma db push
```

Atau dari Vercel CLI:
```bash
npx vercel env pull .env.local
npx prisma db push
```

---

## ⚠️ Important Notes (Free Tier)

### Render Free Tier
- **Spin-down**: Worker akan mati setelah 15 menit tidak ada request
- **Cold start**: Request pertama setelah spin-down butuh ~30 detik
- **Timeout**: Request max 60 detik (video sangat panjang bisa gagal)
- **RAM**: 512MB
- **Storage**: Ephemeral (file hilang saat restart)
- **750 jam/bulan**: Cukup untuk pemakaian normal

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

Kalau Render auto-generate `WORKER_SECRET`, copy nilainya dari Render Dashboard → Environment, lalu tambahkan ke Vercel:

1. Buka Render Dashboard → vortextube-worker → Environment
2. Copy value `WORKER_SECRET`
3. Buka Vercel Dashboard → vortextube → Settings → Environment Variables
4. Tambah `WORKER_SECRET` dengan value yang sama
5. Redeploy: Vercel Dashboard → Deployments → Redeploy

---

## 🧪 Verifikasi

1. Buka `https://your-app.vercel.app`
2. Paste YouTube URL
3. Klik Analyze → harus muncul preview
4. Pilih format → Convert & Download
5. File harus ter-download

Kalau error "Worker not available":
- Cek WORKER_URL di Vercel env sudah benar
- Buka Render dashboard, pastikan worker status "Live"
- Kalau worker sedang spin-down, refresh halaman (butuh ~30s cold start)

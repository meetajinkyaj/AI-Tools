# Ikigaro Health

Ikigaro's health-tracking web app. Built with Next.js, deployed to Cloudflare
Workers (via the OpenNext adapter), using Supabase for database/storage and
Privy for auth + embedded wallets.

This is a separate app from the ikigaro.com marketing site — it will be
served from `app.ikigaro.com`.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

Copy `.env.local.example` to `.env.local` and fill in the values (see the
integration setup notes in the project history for where to find each key).

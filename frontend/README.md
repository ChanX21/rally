# Rally Frontend

Next.js + TypeScript + Tailwind CSS app, configured as a responsive PWA.

## Getting Started

```bash
npm install
cp .env.example .env.local   # then fill in NEXT_PUBLIC_PRIVY_APP_ID
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The app needs the backend running (`backend/FRONTEND_HANDOFF.md`). In `backend/.env`, use the same
Privy app ID, and add `http://localhost:3000` to `CORS_ORIGINS`, or the browser blocks every request.

## Build

```bash
npm run build
npm run start
```

`npm run build` uses webpack (required for PWA service worker generation); dev uses Turbopack.

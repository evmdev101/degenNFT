# DEGEN NFT dashboard

The dashboard is a single React, Vite, and TypeScript application. All NFT, miner, farm, sale, referral, wallet, and theme features live under `src/`; there is no separate legacy site or manually maintained build copy.

## Local development

```bash
pnpm install
pnpm dev
```

Vite serves the dashboard at `http://127.0.0.1:4173/`.

## Verification

```bash
pnpm typecheck
pnpm build
```

The production output is generated in `dist/` and is intentionally ignored by Git.

## Normal update process

Edit the React source, verify it locally, commit, and push to `main`. The GitHub Pages workflow in `.github/workflows/deploy-pages.yml` installs dependencies, type-checks, builds, and publishes `dist` automatically. No manual build or second-site update is required.

## Safety

All write actions show their transaction status and require confirmation in the connected EVM wallet on PulseChain. Destructive NFT and miner withdrawals include explicit warnings. Contract addresses and ABIs are centralized in `src/config/contracts.ts`.

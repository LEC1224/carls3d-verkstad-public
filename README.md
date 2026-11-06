# Carl's 3D-verkstad

A Swedish website for 3D-print quotes and orders, lithophane lamps with personal photos, and Minecraft torches. Built with Next.js 15 Pages Router, React 18, TypeScript, Tailwind CSS, Prisma 5 with SQLite, Formidable, and Three.js.

## Features

- Upload STL/OBJ files, choose material and color per file, set copies, and calculate a detailed price before ordering.
- Open an optional 3D preview in the browser with rotation, zoom, dimensions, and the selected color. Previewing does not upload the file.
- Order a lithophane lamp with four photo previews, or choose the number of Minecraft torches.
- Choose PostNord delivery or pickup, apply a discount code, and keep the order number and total visible after submission.
- Manage orders, searchable filters, available material colors, coupons, and travel notices at `/admin`.
- Optionally notify Discord about new orders. Payment remains via Swish after order confirmation.

## Upload limits

| Use | Formats | Limits |
| --- | --- | --- |
| Standard order / quote | STL, OBJ | 100 MB per file, 20 files and 200 MB per request |
| Browser 3D preview | STL, OBJ | 20 MB per file; very detailed models may be skipped while ordering remains available |
| Lithophane lamp | JPEG (`.jpg`/`.jpeg`), PNG, WebP | Exactly 4 images, 20 MB per image |

Additional copies do not count as extra files. Duplicate cart rows do count toward the file count and total upload size. Temporary uploads are isolated under `uploads/tmp/`; successful orders keep their final files and text receipts under `uploads/`. These directories and the local database are excluded from Git.

## Local development

Use a separate checkout or worktree for development. Do not copy production customer files, databases, environment files, or notification credentials into it. Run the commands below from that checkout's root.

```powershell
npm ci
Copy-Item .env.example .env.local
npx prisma generate
# Initialize only this fresh local checkout's SQLite database:
if (-not (Test-Path -LiteralPath prisma/dev.db)) {
  New-Item -ItemType File -Path prisma/dev.db | Out-Null
}
npx prisma db push
npm run dev -- --hostname 127.0.0.1 --port 3100
```

Edit `.env.local` to set a local `ADMIN_PASSWORD` and a random `ADMIN_SECRET`. Keep `DISCORD_WEBHOOK` empty during local testing so test orders cannot send notifications. The development site is available at [http://127.0.0.1:3100](http://127.0.0.1:3100).

The current Prisma schema uses `provider = "sqlite"` and the literal URL `file:./dev.db`, which resolves to `prisma/dev.db`. **`DATABASE_URL` is not read by this schema.** Changing database configuration requires an explicit schema change and separate migration planning. The setup above initializes a local database; it is not a production migration.

The guarded file creation handles Prisma 5 on Windows reporting `Schema engine error` when the SQLite file does not exist. It leaves an existing database untouched; do not force creation or reset an existing file.

## Environment settings

Start from `.env.example`; do not commit `.env.local` or real credentials.

| Variable | Purpose / code default |
| --- | --- |
| `ADMIN_PASSWORD` | Password for the admin login; required to use admin features |
| `ADMIN_SECRET` | Secret used to sign the admin cookie; required to use admin features |
| `DISCORD_WEBHOOK` | Optional Discord webhook; leave empty for local verification |
| `START_FEE` | Standard-order start fee; default `50` kr |
| `FILL_FACTOR` | Fill factor for the volume-based fallback estimate; default `0.25` |
| `PACKAGING_GRAMS` | Packaging weight used for standard-order shipping; default `30` g |
| `MIN_GRAMS_PER_FILE` | Minimum estimated weight per file; default `5` g |

The `QUOTE_*` settings in `src/lib/estimation.ts` control the detailed estimator. The table lists code defaults, not a production site's configured overrides. Preserve existing business pricing when changing or deploying configuration.

## Verification before review

```powershell
# TypeScript and all regression tests:
npm run check

# Individual checks when investigating a failure:
npm run typecheck
npm test -- --runInBand
npm test -- --runInBand tests/checkoutPage.test.tsx

# Compile an optimized local build; prebuild regenerates Prisma Client:
npm run build
# Check the compiled pages, lazy viewer chunks, and real admin middleware:
node scripts/smoke-built-site.cjs
npm start -- --hostname 127.0.0.1 --port 3100
```

Stop the development server before starting the optimized server on the same port. Building and running locally do not deploy the site.

The built-site smoke check starts and stops its own loopback server on an available port with random disposable login settings and a blank notification webhook. It checks public pages, the compiled admin guard, cookie compatibility, unauthenticated API access, and route metadata without creating orders, reading customer data, or writing the database. Results are saved to `.cache/built-site-smoke/report.json`.

Tests use mocked HTTP/database boundaries and generated temporary fixtures. They cover pricing and estimator equivalence, upload limits and cleanup, multipart file ordering, transactional file persistence, input validation, inventory defaults, stale requests, order submission, and admin recovery. Browser component tests use Jest's jsdom environment; they do not replace a real browser check of WebGL, image layout, or native mobile controls.

For changed customer flows, check the homepage, standard order, lamp, and torch pages at narrow mobile and desktop widths. Verify keyboard navigation, menu/Escape behavior, inline errors, pickup versus shipping, coupon invalidation, and order confirmation using synthetic files and test contact details. Check admin search, filters, and action feedback against the local database. Confirm failed quotes leave no request directories in `uploads/tmp/` and successful test orders retain their final files. Do not run these checks against production.

## Estimator benchmark

```powershell
# Current estimator only:
node scripts/benchmark-estimation.cjs

# Compare with the original estimator in this repository:
node scripts/benchmark-estimation.cjs --baseline=6ef4919
```

The benchmark generates synthetic small, dense, tall, and large STL fixtures, runs each three times, and writes results to `.cache/estimation-benchmark/report.json`. Comparison reports the median runtime, process RSS, and whether the complete estimate is unchanged; mismatched results cause a nonzero exit. Timing varies with the machine and load. The harness does not load `.env.local`, access customer uploads or the database, or send notifications. Its generated cache is ignored by Git.

For optional extended numerical validation, run:

```powershell
node scripts/validate-estimation.cjs --baseline=6ef4919 --cases=100 --seed=20261106
```

This deterministic check compares complete estimates and prices across 100 generated models with varied geometry, materials, and STL/OBJ encodings. The recorded local run matched all 100 estimates and all 100 prices exactly. It writes parameters and per-case results to `.cache/estimation-validation/report.json` and exits nonzero on a mismatch. It is separate from routine tests and uses synthetic files with fixed settings, without loading environment files or contacting services.

These commands are for local implementation and verification. Production deployment is a separate, explicitly authorized operation.

---

## 📄 License

Sharing this code with other 3D print providers will of course hurt my business by increased competition, though the open source community beats louder in my heart! Please show graitude by contributing with your own features to this repo, help me market [https://carls3d.se](https://carls3d.se) or include a link to this GitHub page on your own derivative of this web app! None of this is however required by the MIT License.

MIT License © 2025 Carl's 3D-verkstad


# Site improvements — 6 November 2026

Work is isolated in `codex/site-improvements-2026-11-06`, based on `6ef4919`, under `C:\www-improvements-2026-11-06`. No production deployment, push, production database access, or external order notification was performed. Other work in the original `C:\www` checkout was left untouched.

## Customer-facing changes

- Optional local STL/OBJ previews with rotation, zoom, reset, dimensions and selected color. The viewer loads on demand, renders on interaction, and releases graphics resources on close or failure. File complexity is checked before allocating geometry; oversized previews do not prevent ordering.
- Standard checkout now has clearly labelled steps, a detailed price summary, accessible native material/color controls, inline errors and a persistent order confirmation. Stale quote and availability responses cannot overwrite newer choices. Repeated submission clicks are locked.
- Lamp orders show four removable photo previews, support adding photos in batches, and validate formats and sizes. Lamp and torch orders share customer fields, delivery controls, coupon feedback, price summaries and durable confirmation.
- Coupon prices invalidate when quantity, delivery or code changes. Read requests have bounded deadlines and recoverable errors. Order writes are not automatically retried after an uncertain connection failure.
- Homepage gallery appears in the server-rendered page, loads a limited set of images, and supports pause, previous/next and keyboard controls. Reduced motion and hidden-tab behavior are respected.
- Responsive navigation, skip navigation, visible focus, Swedish document language, route metadata, canonical URLs, sitemap, robots file and a useful 404 page improve navigation and discovery.

## Reliability and admin changes

- Uploads use bounded, isolated temporary directories with cleanup on success and failure. Validation covers file count, individual/total size, image signatures, quantity, customer data, supported materials and available colors.
- Multipart file order is preserved independently of disk completion order, keeping each model paired with its selected material, color and copies. Swedish, spaced and multi-dot filenames retain the correct final extension.
- Order rows and file metadata commit in a transaction after files are copied. Failed attempts remove their own partial files. Existing destination collisions use a unique alternative without overwriting another file.
- Nonfinite, negative and unpersistable price amounts are rejected before returning a quote or storing an order.
- Changing the first saved color for a material preserves availability of the other colors.
- Admin orders have search, product/status/delivery filters, pagination, counts and clear action feedback. Failed initial reads do not show invented empty data. Pagination remains stable after deletion and refresh.
- Pending read/write results are ignored after navigation; login requests time out safely. Admin data is marked private/no-store and redirects are validated.
- The admin page middleware was moved into `src/`, where Next.js actually compiles it, and uses Edge-compatible Web Crypto matching the existing signed cookie format.
- Discord delivery is best-effort with an eight-second deadline, so a notification failure does not discard a committed order.

## Performance and dependencies

The estimator now processes triangles through a sorted layer sweep instead of scanning the entire mesh for each layer. Large meshes avoid retaining triangle objects when they use the existing volume fallback. Existing pricing defaults and estimator results were preserved.

Local median runtime across three runs per fixture:

| Synthetic fixture | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Small box | 19 ms | 17 ms | 11% |
| Dense 120,000-triangle box | 1,822 ms | 630 ms | 65% |
| Tall 120,000-triangle box | 2,286 ms | 614 ms | 73% |
| Large 388,800-triangle fallback | 121 ms | 68 ms | 44% |

The large fallback's process RSS fell from 297 MB to 116 MB in this run. Dense/tall RSS was approximately unchanged. These are local synthetic measurements, not production latency guarantees. Estimation remains synchronous.

- Next.js updated to 15.5.29; React 18 retained for Pages Router compatibility.
- Unused mail/database/schema and React Three wrapper packages removed; compatible transitive dependencies updated.
- Production dependency audit: **zero reported vulnerabilities**. Full audit: **seven low-severity entries**, all stemming from development-only Jest/deepmerge dependencies. The registry's latest deepmerge release was still affected; no forced downgrade was applied. No moderate/high/critical entries remained.
- Optimized initial JavaScript: approximately 96 kB for the homepage and 104 kB for checkout. The 3D viewer chunks are excluded until a preview opens.

## Verification

- TypeScript check and **213 tests across 25 suites passed**.
- Optimized Next.js build passed, including the compiled middleware.
- **Eight built-site integration checks passed**, covering public routes, lazy preview chunks, authentication redirects, signed-cookie compatibility, private APIs, login redirect/cookie behavior and recovery routes.
- **100 complete estimates and 100 price breakdowns matched the baseline exactly** across varied geometry, five materials and binary STL/ASCII STL/OBJ encodings.
- Real local browser checks covered mobile/tablet/desktop layouts, all three order types, photo previews, coupons and pickup pricing, STL/OBJ previews, admin login/search/status/logout and 404 recovery. No browser errors were observed in the final checks.
- Two simultaneous multi-file orders persisted correctly in the disposable SQLite database. Their four saved files matched the uploaded bytes, receipts matched material/color/copies, quote/order prices agreed, and no temporary request directories remained.
- Real inventory checks preserved 41 other colors on the first toggle, rejected unavailable colors, restored availability, and rejected an oversized model price with a clear 400 response.
- Extended quote/upload stability monitoring is in progress until 19:55 Stockholm time; final results will be added after completion.

Reproduction commands and safe local setup are documented in `README.md`. Synthetic benchmark, smoke-check and extended-validation reports are under ignored `.cache/`; local browser/order/stability fixtures are under ignored `.local-review/`. No customer data or credentials are committed.

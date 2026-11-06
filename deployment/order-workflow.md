# Order email and Bambu project workflow

The production app on HP-PRODESK saves a durable JSON order manifest in
`C:\3dproxy\carls3d\data\order-workflow` after uploads have their final names.
This retains each file's quantity, material, color and intended use. Existing
orders are not automatically emailed again or retroactively processed.

All three checkout routes send Swedish customer confirmations and owner
notifications through Resend. The owner address comes from `ORDER_NOTIFICATION_EMAIL`. Sender and customer
reply address: `info@carls3d.se`. The owner notification's Reply-To is the customer.
No email credentials or workflow tokens are embedded in source or task arguments.

Each recipient has an independent persistent state and Resend idempotency key.
The exact payload is saved before sending; accepted message IDs are saved after
each send. A scheduled server task retries failures every minute. Ambiguous
attempts older than 23 hours require manual delivery-history reconciliation
because Resend retains idempotency keys for 24 hours. A queued job is never
silently reset by a duplicate enqueue. The admin order list displays states.
`sent` means Resend accepted the message, not proof of inbox delivery.

## Configuration

Server `.env.local`: `RESEND_API_KEY`, `ORDER_NOTIFICATION_EMAIL`,
`ORDER_FROM_EMAIL`, `ORDER_REPLY_TO_EMAIL`, `ORDER_WORKFLOW_TOKEN`,
`ORDER_WORKFLOW_DIR`. The source credential is reused securely; do not paste it
in chat, logs or commits.

Desktop `.env.local`: matching `ORDER_WORKFLOW_TOKEN`, optional
`ORDER_WORKFLOW_URL` (defaults to the HTTPS production endpoint) and
`ORDER_PRINT_ROOT` (defaults to `D:\Documents\3D-prints\Beställningar`).

The local `scripts/order_print_worker.py` polls the authenticated endpoint,
downloads original files to private staging, calls `build_order_3mf.py`, and
acknowledges completion only after the project exists. Network outages retry;
completed local results retry acknowledgment without regenerating the project.
The desktop must be on and the scheduled task must be able to run. Orders remain
queued on the server while it is offline. There is no Discord dependency.

Installed scheduled tasks: `Carls3D-OrderPrintPackages` on Carls-Desktop;
`Carls3D Web` and `Carls3D Email Retry` on HP-PRODESK. They use the existing
`carl1` interactive Windows identity: machines must be on and that account
signed in (locking the screen is fine). They survive SSH disconnects and
restart at login; this does not turn either machine into a boot-time service.

The 2026-11-06 production rollback is
`C:\3dproxy\carls3d-deploy-backups\order-workflow-20261106-171711\rollback.ps1`.
It restores the prior build/source/environment without removing orders or uploads.

## Print projects

Folders use the numeric order ID padded to at least three digits, followed by
the sanitized customer name, for example `042-Anna Andersson`. The full public
order reference is retained in the 3MF filename and manifest.

Standard STL/OBJ orders get original files, order metadata and a native Bambu
Studio project. Presets use P1S 0.4 mm, Textured PEI Plate, 0.20 mm layers,
generic material profiles, 3D gyroid infill, automatic orientation and automatic
tree supports. General parts use 3 walls/15% infill; parts marked functional in
checkout use 4 walls/25%. Individual filament/color groups use separate plates,
with additional plates when needed. Quantities and filament assignments are
validated after Bambu's native export. Actual spool/AMS matching, load direction,
support contact and the sliced preview must be checked before printing. No job
is sent to the printer automatically.

Lithophane orders contain photographs rather than printable meshes; Minecraft
torch orders have no uploaded mesh. These get a review record and preserved
inputs, not an invented 3MF. They need a verified model/generator configuration
before automatic print projects can be enabled. Unknown materials/colors,
oversized models and other conversion errors are also marked for review.

Existing customer folders are never overwritten. Errors appear in the admin
list and `data/print-worker/worker.log`; generation diagnostics are stored per
order in `data/print-worker/<id>/build.log`. Failed-generation inputs are kept
with `REVIEW.txt`, or in local staging when the target folder already exists.

## Recovery and validation

Before retrying a reviewed email, inspect its Resend ID/history; do not reset a
successful or uncertain delivery blindly. Before retrying a reviewed print,
resolve its recorded error and preserve any hand-edited 3MF. Queue files contain
customer details and must be included in the site's private backup/retention
policy, along with the database and uploads. They must never be web-served.

Tests: `npm test -- --runInBand`, `npm run build`, and
`python -m unittest discover -s tests -p test_order_3mf.py`. Native Bambu export
tests are documented in the Python test file.

Cloudflare's existing incoming-email routing is preserved. Resend sends mail;
it is not an IMAP/Exchange mailbox. Adding an info@ mailbox to New Outlook was
explicitly deferred by the owner.

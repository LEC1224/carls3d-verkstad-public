# Google review redirect

`/review` redirects to `https://share.google/BoBAlmEXkc16y76rY`.

The production site runs behind IIS on HP-PRODESK. Run
`enable-review-redirect.ps1` on that server to insert the review redirect before
the existing reverse proxy rule. It supports `/review` and `/review/`, keeps all
other configuration, and makes a timestamped backup before replacing the config.
No Next.js process restart is required.

`next.config.js` also provides the redirect when the app runs without IIS.

The order insert is a single-sided A6 PDF (105 x 148 mm). Generate it on Windows
with `python scripts/build_thank_you_card.py` using ReportLab. The generator uses
the website's logo and Segoe UI fonts. Print `output/pdf/carls3d-tackkort-a6.pdf`
at actual size (100%). Its QR code points directly to the same Google link.

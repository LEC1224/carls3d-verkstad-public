# Carl's 3D-verkstad

Carl's 3D-verkstad is a Next.js web application for uploading 3D printing files, getting instant price estimates, and ordering prints.  
It supports lithophane cube previews, FDM price calculation, and a smooth checkout flow.

---

## 🚀 Features

- **3D File Upload**
  - Supports STL and other common 3D printing formats.
  - File-based price calculation before entering shipping details.
- **Lithophane Cube Generator**
  - Showcases what a lithophane cube is with an example image.
- **Price Estimation**
  - Quick "Beräkna pris" (Calculate Price) button next to file upload.
- **Checkout**
  - Simple form for shipping details after price check.
- **Responsive Design**
  - Works on desktop, tablet, and mobile.
- **Branding**
  - Fully branded as **Carl’s 3D-verkstad** with custom header, footer, and About page.

---

## 📦 Tech Stack

- **Framework**: [Next.js](https://nextjs.org/)
- **Backend**: [Prisma](https://www.prisma.io/) ORM with SQLite/PostgreSQL
- **File Handling**: [Formidable](https://github.com/node-formidable/formidable) for uploads
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Language**: TypeScript

---

## ⚙️ Installation & Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

The app will be available at [http://localhost:3000](http://localhost:3000).

---

## 📸 Screenshots

### Homepage
![Homepage screenshot](public/screenshot-home.png)

### Lithophane Cube Example
![Lithophane cube example](public/lithophane-example.png)

---

## 📄 License

MIT License © 2025 Carl's 3D-verkstad

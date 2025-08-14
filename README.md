# Svensk 3D-printtjänst

## Installation
```bash
npm install
npx prisma migrate dev
```

## Miljövariabler
Skapa `.env.local`:
```
EMAIL_USER=din-email
EMAIL_PASS=din-lösenord
DATABASE_URL="file:./prisma/dev.db"
```

## Starta lokalt
```bash
npm run dev
```

## Bygg
```bash
npm run build && npm start
```

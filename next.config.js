/** @type {import('next').NextConfig} */
module.exports = {
  async redirects() {
    return [
      {
        source: "/review",
        destination: "https://share.google/BoBAlmEXkc16y76rY",
        permanent: false,
      },
    ];
  },
};

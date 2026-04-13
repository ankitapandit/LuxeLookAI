/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "10.0.0.76"
  ],
  images: {
    // Allow Supabase storage images
//     domains: ["*.supabase.co", "supabase.co", "via.placeholder.com"],
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "via.placeholder.com" },
      { protocol: "https", hostname: "placehold.co" },
      { protocol: "https", hostname: "images.pexels.com" },
    ],
  },
  async redirects() {
    return [
      {
        source: "/events",
        destination: "/event",
        permanent: true,
      },
      {
        source: "/outfits",
        destination: "/archive",
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;

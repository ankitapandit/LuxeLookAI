const os = require("os");

function getLocalIpv4Hosts() {
  const interfaces = os.networkInterfaces();
  const hosts = new Set(["localhost", "127.0.0.1"]);

  for (const network of Object.values(interfaces)) {
    for (const address of network || []) {
      if (address && address.family === "IPv4" && !address.internal && address.address) {
        hosts.add(address.address);
      }
    }
  }

  return Array.from(hosts);
}

module.exports = () => ({
  reactStrictMode: true,
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  allowedDevOrigins: getLocalIpv4Hosts(),
  images: {
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
});

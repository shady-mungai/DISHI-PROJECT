import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mlo Reader",
    short_name: "Mlo",
    description: "School meal tap reader",
    start_url: "/reader",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#000000",
    icons: [{ src: "/globe.svg", sizes: "any", type: "image/svg+xml" }],
  };
}

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dishi Reader",
    short_name: "Dishi",
    description: "School meal tap reader",
    start_url: "/reader",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#000000",
    icons: [{ src: "/globe.svg", sizes: "any", type: "image/svg+xml" }],
  };
}

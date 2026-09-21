import type { Metadata } from "next";
import { Rubik } from "next/font/google";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { getToken } from "./lib/auth-server";
import "./globals.css";

const rubik = Rubik({
  variable: "--font-rubik",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dishi",
  description: "School feeding platform",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const initialToken = await getToken();

  return (
    <html
      lang="en"
      className={`${rubik.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ConvexClientProvider initialToken={initialToken}>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}

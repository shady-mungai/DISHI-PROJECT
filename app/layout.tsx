import { cookies } from "next/headers";
import type { Metadata } from "next";
import { DM_Serif_Display, Inter } from "next/font/google";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { getToken } from "./lib/auth-server";
import "./globals.css";
import { Suspense } from "react";
import { Workspace } from "./components/Workspace";

const serif = DM_Serif_Display({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-editorial",
});
const sans = Inter({ subsets: ["latin"], variable: "--font-editorial-sans" });

export const metadata: Metadata = {
  title: "Mlo | Every meal matters",
  description:
    "School feeding, connected. Mlo brings meal service, deliveries and programme oversight into one shared system.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const cookieStore = await cookies();
  const initialToken = cookieStore.size > 0 ? await getToken() : undefined;

  return (
    <html
      lang="en"
      className={`${serif.variable} ${sans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ConvexClientProvider initialToken={initialToken}>
          <Suspense fallback={<p role="status">Loading workspace…</p>}>
            <Workspace>{children}</Workspace>
          </Suspense>
        </ConvexClientProvider>
      </body>
    </html>
  );
}

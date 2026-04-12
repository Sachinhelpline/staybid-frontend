import "./globals.css";
import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth";
import { Navbar } from "@/components/Navbar";
import { ServerStatus } from "@/components/ServerStatus";

export const metadata: Metadata = {
  title: "StayBid — Bid Your Stay, Save Big",
  description: "India's first reverse-auction hotel booking platform. Name your price, hotels compete for your booking. Discover premium mountain stays at prices you choose.",
  keywords: "hotel bidding, reverse auction, budget hotels, mountain stays, Mussoorie, Rishikesh, Shimla, Manali",
  openGraph: {
    title: "StayBid — Name Your Price. Hotels Compete.",
    description: "India's first reverse-auction hotel platform. Bid on premium stays and save up to 40%.",
    siteName: "StayBid",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <ServerStatus />
          <Navbar />
          <main className="min-h-screen">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}

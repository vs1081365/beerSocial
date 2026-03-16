import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BeerFriends - Encontre amigos cervejeiros e partilhe as suas avaliações de cerveja",
  description: "A rede social para amantes de cerveja - descubra, avalie e partilhe as suas cervejas favoritas com amigos",
  keywords: ["cerveja", "social", "React"],
  authors: [{ name: "BeerFriends Team" }],
  icons: {
    icon: "/beer-mug.svg",
  },
  openGraph: {
    title: "BeerFriends - Encontre amigos cervejeiros e partilhe as suas avaliações de cerveja",
    description: "A rede social para amantes de cerveja - descubra, avalie e partilhe as suas cervejas favoritas com amigos",
    url: "https://beerfriends.com",
    siteName: "BeerFriends",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BeerFriends",
    description: "A rede social para amantes de cerveja - descubra, avalie e partilhe as suas cervejas favoritas com amigos",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}

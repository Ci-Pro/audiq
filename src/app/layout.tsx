import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Audiq - YouTube to MP3 & MP4 Converter",
  description: "Convert YouTube videos to high-quality MP3 and MP4 files. Fast, free, and no registration required.",
  keywords: ["YouTube downloader", "YouTube to MP3", "YouTube to MP4", "video converter", "MP3 converter"],
  authors: [{ name: "Audiq" }],
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Audiq - YouTube to MP3 & MP4 Converter",
    description: "Convert YouTube videos to high-quality MP3 and MP4 files. Fast, free, and no registration required.",
    type: "website",
    siteName: "Audiq",
  },
  twitter: {
    card: "summary",
    title: "Audiq - YouTube to MP3 & MP4 Converter",
    description: "Convert YouTube videos to high-quality MP3 and MP4 files. Fast, free, and no registration required.",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono, Quantico } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Brand wordmark font — matches the PHIXO logo in the pitch deck.
const quantico = Quantico({
  variable: "--font-quantico",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Phixo — faster stroke recovery",
  description:
    "Bedside assist-as-needed rehabilitation companion for the acute Day 1–7 stroke window. Proof of concept.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${quantico.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

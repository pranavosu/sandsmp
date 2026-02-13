import type { Metadata } from "next";
import { Silkscreen, DM_Sans } from "next/font/google";
import "./globals.css";

const silkscreen = Silkscreen({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-pixel",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Falling Sand",
  description: "A pixel physics sandbox",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${silkscreen.variable} ${dmSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}

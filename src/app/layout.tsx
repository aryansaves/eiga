import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EIGA — Your cinema, mapped.",
  description:
    "Turn your Letterboxd history into an interactive map of your movie taste. Processed entirely in your browser.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="bg-void text-paper flex min-h-full flex-col">
        {children}
      </body>
    </html>
  );
}

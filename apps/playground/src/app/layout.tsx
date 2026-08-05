import type { Metadata } from "next";
import "@superchat/ui/styles.css";
import "./globals.css";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "superchat — dev panels",
  description: "Contexts, skills, tools and cards — assembled into provider-correct requests.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}

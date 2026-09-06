import type { Metadata, Viewport } from "next";
import "@zzyzxlabs/super-chat-ui/styles.css";
import "../../../playground/src/app/globals.css";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "SuperChat — domain agents beyond chat",
  description: "A browser-only showcase of SuperChat's provider-neutral agent runtime.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><Shell>{children}</Shell></body></html>;
}

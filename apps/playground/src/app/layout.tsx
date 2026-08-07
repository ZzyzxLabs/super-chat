import type { Metadata, Viewport } from "next";
import "@superchat/ui/styles.css";
import "./globals.css";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "superchat — dev panels",
  description: "Contexts, skills, tools and cards — assembled into provider-correct requests.",
};

// interactiveWidget is the part that matters on a phone: by default the
// virtual keyboard overlays the viewport, so a sticky-bottom composer ends up
// underneath it. resizes-content shrinks the layout viewport instead, which
// lifts the composer above the keyboard with no JS and no VisualViewport
// listener. maximumScale is left alone deliberately — locking zoom is an
// accessibility regression, and the 16px rule in styles.css already removes
// the reason people reach for it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
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

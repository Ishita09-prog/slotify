"use client";

import { PortalChooser } from "@/components/auth/portal";

/** The site opens straight on "Who's signing in?" (same screen as /login). */
export default function Home() {
  return <PortalChooser />;
}

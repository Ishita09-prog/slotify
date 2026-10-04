"use client";

import dynamic from "next/dynamic";

const Story3D = dynamic(() => import("@/components/howto/story3d"), {
  ssr: false,
  loading: () => <div className="grid h-dvh place-items-center bg-[#0b1020] text-sm text-white/60">Loading 3D scene…</div>,
});

/** Public "How it works" explainer: clickable 3D story of booking → gate → payment → fraud checks. */
export default function HowItWorks() {
  return <Story3D />;
}

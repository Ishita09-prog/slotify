"use client";

import { ArrowRight } from "lucide-react";
import { Panel } from "@/components/command/ui";
import { CameraWall } from "@/components/vision/camera-wall";
import { OperatorFootage } from "@/components/command/operator-footage";

const STEPS = [
  ["Camera", "CCTV / drone frame, 1080p"],
  ["Edge AI box", "YOLO detects every vehicle, tracker keeps IDs stable"],
  ["Bay status", "vehicle inside a bay → occupied; empty for 3 frames → free"],
  ["Cloud", "bay colours update on every driver's phone"],
  ["Forecast", "live counts feed the occupancy model"],
];

export default function CamerasPage() {
  return (
    <div className="space-y-3">
      <div>
        <p className="cc-label">Live camera feeds</p>
        <h1 className="font-display text-2xl font-bold text-slate-50">AI vehicle detection · 4 cameras</h1>
        <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--cc-dim))]">
          Recorded parking-lot footage processed by the edge AI box. Detection runs next to the camera (no video is uploaded to the cloud); only counts and bay states are sent.
        </p>
      </div>
      <CameraWall />
      <OperatorFootage />
      <Panel title="How a frame becomes a bay colour">
        <div className="flex flex-wrap items-center gap-2 p-3 text-xs">
          {STEPS.map(([t, d], i) => (
            <div key={t} className="flex items-center gap-2">
              <div className="rounded-md border border-[hsl(var(--cc-line))] px-3 py-2">
                <p className="font-semibold text-slate-100">{t}</p>
                <p className="text-[hsl(var(--cc-dim))]">{d}</p>
              </div>
              {i < STEPS.length - 1 && <ArrowRight className="size-4 text-sky-400" />}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

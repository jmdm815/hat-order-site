"use client";

import { useEffect, useRef, useState } from "react";
import { composeMockup } from "@/lib/mockup-render/compose";
import { loadImage } from "@/lib/mockup-render/canvas-utils";
import type { MockupConfig } from "@/lib/mockup-store";
import { MockupDecorationMethod, MockupHatCalibration, PatchMaterial, PatchShape, PatchSize } from "@/lib/mockup-types";
import type { Product } from "@/lib/types";

// ---------------------------------------------------------------------------
// Internal smoke-test harness for the mockup rendering engines (phase 2).
// Renders the same synthetic logo, on the same Richardson 112 "Black/ White"
// hat photo, through all three decoration-method engines side by side so a
// human can judge whether the deterministic canvas rendering looks
// convincing. Not part of the customer-facing configurator (that's phase 3).
// ---------------------------------------------------------------------------

const HAT_STYLE_NUMBER = "112";
const HAT_COLOR_NAME = "Black/ White";

type Slot = {
  key: string;
  label: string;
  method: MockupDecorationMethod;
  materialName?: string;
  shapeName?: string;
  sizeName?: string;
};

const SLOTS: Slot[] = [
  { key: "embroidered", label: "Embroidered", method: "embroidered" },
  {
    key: "engraved",
    label: "Engraved",
    method: "engraved",
    materialName: "Rawhide / Black",
    shapeName: "Rounded Rectangle",
    sizeName: '3" x 2"',
  },
  {
    key: "uv",
    label: "UV Printed",
    method: "uv",
    materialName: "White",
    shapeName: "Rounded Rectangle",
    sizeName: '3" x 2"',
  },
];

// Draws a simple multi-colored mountain-and-trees silhouette test logo:
// white/gray triangular peaks with a darker outline, plus small green
// triangular trees along the bottom — transparent background, ~400x200,
// with enough fine detail to test whether small-detail legibility survives
// the embroidery/engraving effects.
function drawSyntheticLogo(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 200;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 400, 200);

  // Mountain peaks.
  function peak(baseX: number, baseY: number, width: number, height: number, fill: string) {
    ctx.beginPath();
    ctx.moveTo(baseX - width / 2, baseY);
    ctx.lineTo(baseX, baseY - height);
    ctx.lineTo(baseX + width / 2, baseY);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#3a3a3a";
    ctx.stroke();
  }

  const groundY = 165;
  peak(120, groundY, 180, 110, "#e8e8e8");
  peak(220, groundY, 200, 140, "#f5f5f5");
  peak(300, groundY, 150, 90, "#cfcfcf");

  // Small tree shapes along the bottom (fine-detail test).
  function tree(x: number, y: number, scale: number) {
    ctx.fillStyle = "#2e6b3a";
    for (let i = 0; i < 3; i++) {
      const w = 22 * scale * (1 - i * 0.18);
      const h = 16 * scale;
      const yy = y - i * h * 0.65;
      ctx.beginPath();
      ctx.moveTo(x - w / 2, yy);
      ctx.lineTo(x, yy - h);
      ctx.lineTo(x + w / 2, yy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#5a3a22";
    ctx.fillRect(x - 2, y - 4, 4, 10);
  }

  const treeXs = [40, 75, 110, 290, 325, 360];
  treeXs.forEach((x, i) => tree(x, groundY + 6, 0.9 + (i % 2) * 0.2));

  return canvas;
}

function findMaterial(config: MockupConfig, name?: string): PatchMaterial | undefined {
  if (!name) return undefined;
  return config.patchMaterials.find((m) => m.name === name);
}
function findShape(config: MockupConfig, name?: string): PatchShape | undefined {
  if (!name) return undefined;
  return config.patchShapes.find((s) => s.name === name);
}
function findSize(config: MockupConfig, name?: string): PatchSize | undefined {
  if (!name) return undefined;
  return config.patchSizes.find((s) => s.name === name);
}

export default function MockupTestHarness() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [renderKey, setRenderKey] = useState(0);
  const containerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [readyCount, setReadyCount] = useState(0);

  async function runAsync() {
    setStatus("loading");
    setError(null);
    setReadyCount(0);
    try {
      const [catalogRes, configRes] = await Promise.all([
        fetch("/api/catalog?type=hat"),
        fetch("/api/admin/mockup-config"),
      ]);
      if (!catalogRes.ok) throw new Error(`/api/catalog failed: ${catalogRes.status}`);
      if (!configRes.ok) throw new Error(`/api/admin/mockup-config failed: ${configRes.status}`);

      const catalog = (await catalogRes.json()) as Product[];
      const { config } = (await configRes.json()) as { config: MockupConfig };

      const hatProduct = catalog.find((p) => p.styleNumber === HAT_STYLE_NUMBER);
      if (!hatProduct) throw new Error(`No catalog product with styleNumber "${HAT_STYLE_NUMBER}"`);
      const hatColor = hatProduct.colors.find((c) => c.colorName === HAT_COLOR_NAME);
      if (!hatColor) throw new Error(`No "${HAT_COLOR_NAME}" color for style ${HAT_STYLE_NUMBER}`);

      const logoCanvas = drawSyntheticLogo();
      const logoDataUrl = logoCanvas.toDataURL("image/png");

      const [hatImage, artworkImage] = await Promise.all([
        loadImage(hatColor.imageUrl),
        loadImage(logoDataUrl),
      ]);

      // Calibrated by eye against a percentage-gridline overlay of the actual
      // Richardson 112 "Black/ White" product photo: the flat front panel
      // (where a logo/patch belongs) sits roughly x 30%-65%, y 17%-29% of the
      // full photographed hat's bounding box (the photo is a 3/4 angle shot,
      // so that bounding box includes the brim/back of the hat, not just the
      // frontal panel - hence refWidthIn is calibrated well above a real
      // frontal panel width so the patch doesn't overflow the panel).
      const calibration: MockupHatCalibration = {
        styleNumber: HAT_STYLE_NUMBER,
        centerXPct: 47,
        centerYPct: 23,
        maxWidthIn: config.methodSettings.embroidery.defaultMaxWidthIn,
        maxHeightIn: config.methodSettings.embroidery.defaultMaxHeightIn,
        refWidthIn: 16,
        perspectiveTiltDeg: 0,
        perspectiveBulgePct: 0,
      };

      let done = 0;
      await Promise.all(
        SLOTS.map(async (slot) => {
          const material = findMaterial(config, slot.materialName);
          const shape = findShape(config, slot.shapeName);
          const size = findSize(config, slot.sizeName);

          const canvas = await composeMockup({
            hatImage,
            artworkImage,
            method: slot.method,
            material,
            shape,
            size,
            calibration,
            methodSettings: config.methodSettings,
            mockupSettings: config.mockupSettings,
          });

          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.style.display = "block";
          canvas.style.borderRadius = "8px";

          const host = containerRefs.current[slot.key];
          if (host) {
            host.innerHTML = "";
            host.appendChild(canvas);
          }
          done += 1;
          setReadyCount(done);
        })
      );

      setStatus("ready");
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStatus("error");
    }
  }

  function run() {
    // Deferred to a microtask so the effect body itself never calls
    // setState synchronously (runAsync's first statement does).
    Promise.resolve().then(runAsync);
  }

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey]);

  const allReady = status === "ready" && readyCount === SLOTS.length;

  return (
    <div data-ready={allReady ? "true" : "false"}>
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => setRenderKey((k) => k + 1)}
          className="text-sm font-medium bg-navy text-white rounded-lg px-4 py-2 hover:bg-navy/90"
        >
          Re-render
        </button>
        <span className="text-sm text-navy/60">
          {status === "loading" && `Rendering… (${readyCount}/${SLOTS.length})`}
          {status === "ready" && "Done"}
          {status === "error" && "Failed"}
        </span>
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {SLOTS.map((slot) => (
          <div key={slot.key} className="border border-navy/10 rounded-xl bg-white p-3">
            <h2 className="text-sm font-semibold text-navy mb-2">{slot.label}</h2>
            <div ref={(el) => { containerRefs.current[slot.key] = el; }} className="bg-neutral-100 rounded-lg min-h-[200px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

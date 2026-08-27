"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

// Shared percent-based drag/resize(/rotate) interaction, used by both the
// admin placement-zone editor (defining a zone rectangle on a garment
// photo — move/resize only) and the customer artwork/text-layer preview
// (positioning + rotating a design layer within a zone). Semantics differ
// per caller — this component just handles the pointer math: convert
// pointer position within a bounding container to a 0-100 percent
// coordinate, and report drag (move) / resize (bottom-right handle) /
// rotate (top-right handle, admin editor doesn't use it) deltas back to
// the caller. No new npm dependency — plain pointer events.

export type Box = { x: number; y: number; width: number; height: number };

type DragResizeBoxProps = {
  // The element whose bounding box drag/resize percentages are computed
  // against (e.g. the garment image wrapper). Percent coordinates are 0-100.
  containerRef: React.RefObject<HTMLElement | null>;
  box: Box;
  onChange: (next: Box) => void;
  // Current rotation in degrees. Optional — callers that don't care about
  // rotation (e.g. the admin zone editor) can omit both this and onRotate,
  // and the rotate handle simply won't render.
  rotation?: number;
  onRotate?: (degrees: number) => void;
  minSize?: number; // minimum width/height in percent
  maxSize?: number; // maximum width/height in percent (clamped to container)
  className?: string;
  style?: React.CSSProperties;
  children?: ReactNode;
  label?: string;
  selected?: boolean;
  onSelect?: () => void;
  // While dragging (move only), the box's center is compared against this
  // point (percent-of-container, same space as `box`) and snaps to it —
  // with a guide line drawn across the container — when within
  // SNAP_THRESHOLD. Typically the active print zone's center. Omit either
  // axis to only snap on the other. Ignored entirely when snapEnabled is
  // false, so the caller can offer a "disable snapping" toggle.
  snapTarget?: { x?: number; y?: number };
  snapEnabled?: boolean;
};

const SNAP_THRESHOLD = 2.5; // percent-of-container

export default function DragResizeBox({
  containerRef,
  box,
  onChange,
  rotation = 0,
  onRotate,
  minSize = 4,
  maxSize = 100,
  className = "",
  style,
  children,
  label,
  selected,
  onSelect,
  snapTarget,
  snapEnabled = true,
}: DragResizeBoxProps) {
  const [snapGuides, setSnapGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const dragState = useRef<{
    mode: "move" | "resize" | "rotate";
    startX: number;
    startY: number;
    startBox: Box;
    startRotation: number;
    centerX: number; // viewport px, for rotate math
    centerY: number;
    startAngle: number; // pointer angle from center at drag start, degrees
  } | null>(null);

  const clamp = useCallback((v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)), []);

  function handlePointerDown(e: React.PointerEvent, mode: "move" | "resize" | "rotate") {
    e.preventDefault();
    e.stopPropagation();
    onSelect?.();
    (e.target as Element).setPointerCapture?.(e.pointerId);

    const rect = containerRef.current?.getBoundingClientRect();
    const centerX = rect ? rect.left + ((box.x + box.width / 2) / 100) * rect.width : e.clientX;
    const centerY = rect ? rect.top + ((box.y + box.height / 2) / 100) * rect.height : e.clientY;
    const startAngle = (Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180) / Math.PI;

    dragState.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startBox: box,
      startRotation: rotation,
      centerX,
      centerY,
      startAngle,
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const state = dragState.current;
    if (!state) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (state.mode === "rotate") {
      const angle = (Math.atan2(e.clientY - state.centerY, e.clientX - state.centerX) * 180) / Math.PI;
      const delta = angle - state.startAngle;
      onRotate?.(Math.round(state.startRotation + delta));
      return;
    }

    const dxPct = ((e.clientX - state.startX) / rect.width) * 100;
    const dyPct = ((e.clientY - state.startY) / rect.height) * 100;

    if (state.mode === "move") {
      const width = state.startBox.width;
      const height = state.startBox.height;
      let x = clamp(state.startBox.x + dxPct, 0, 100 - width);
      let y = clamp(state.startBox.y + dyPct, 0, 100 - height);

      let snappedX = false;
      let snappedY = false;
      if (snapEnabled && snapTarget) {
        if (snapTarget.x !== undefined) {
          const centerX = x + width / 2;
          if (Math.abs(centerX - snapTarget.x) < SNAP_THRESHOLD) {
            x = clamp(snapTarget.x - width / 2, 0, 100 - width);
            snappedX = true;
          }
        }
        if (snapTarget.y !== undefined) {
          const centerY = y + height / 2;
          if (Math.abs(centerY - snapTarget.y) < SNAP_THRESHOLD) {
            y = clamp(snapTarget.y - height / 2, 0, 100 - height);
            snappedY = true;
          }
        }
      }
      if (snappedX !== snapGuides.x || snappedY !== snapGuides.y) setSnapGuides({ x: snappedX, y: snappedY });
      onChange({ ...state.startBox, x, y });
    } else {
      const width = clamp(state.startBox.width + dxPct, minSize, Math.min(maxSize, 100 - state.startBox.x));
      const height = clamp(state.startBox.height + dyPct, minSize, Math.min(maxSize, 100 - state.startBox.y));
      onChange({ ...state.startBox, width, height });
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (dragState.current) {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    }
    dragState.current = null;
    if (snapGuides.x || snapGuides.y) setSnapGuides({ x: false, y: false });
  }

  return (
    <>
      {snapGuides.x && snapTarget?.x !== undefined && (
        <div
          className="absolute top-0 bottom-0 w-px bg-red pointer-events-none z-40"
          style={{ left: `${snapTarget.x}%` }}
        />
      )}
      {snapGuides.y && snapTarget?.y !== undefined && (
        <div
          className="absolute left-0 right-0 h-px bg-red pointer-events-none z-40"
          style={{ top: `${snapTarget.y}%` }}
        />
      )}
      <div
      role="presentation"
      onPointerDown={(e) => handlePointerDown(e, "move")}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={`absolute cursor-move select-none touch-none ${className}`}
      style={{
        left: `${box.x}%`,
        top: `${box.y}%`,
        width: `${box.width}%`,
        height: `${box.height}%`,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: "center center",
        ...style,
      }}
    >
      {children}
      {label && (
        <span className="pointer-events-none absolute -top-5 left-0 text-[10px] font-medium bg-navy text-white px-1.5 py-0.5 rounded whitespace-nowrap">
          {label}
        </span>
      )}
      {selected !== false && (
        <div
          onPointerDown={(e) => handlePointerDown(e, "resize")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="absolute -right-1.5 -bottom-1.5 w-3.5 h-3.5 rounded-sm bg-red border border-white cursor-nwse-resize touch-none"
        />
      )}
      {selected !== false && onRotate && (
        <div
          onPointerDown={(e) => handlePointerDown(e, "rotate")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-navy border border-white cursor-alias touch-none flex items-center justify-center"
          aria-label="Rotate"
        >
          <span className="block w-1 h-1 rounded-full bg-white" />
        </div>
      )}
      </div>
    </>
  );
}

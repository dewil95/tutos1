"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The merchant draws their signature with a finger or the mouse. The drawing goes into a hidden
 * field as a PNG data URL; unless optional, the form will not submit without one.
 */
export function SignaturePad({
  name,
  label,
  clearLabel,
  requiredMessage,
  optional = false,
}: {
  name: string;
  label: string;
  clearLabel: string;
  requiredMessage: string;
  /** Without a drawing the form still submits (the typed name is the signature). */
  optional?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  const [warn, setWarn] = useState(false);

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#13223f";
    const form = c.closest("form");
    const onSubmit = (e: SubmitEvent) => {
      if (!optional && !field.current?.value) {
        e.preventDefault();
        setWarn(true);
        c.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };
    form?.addEventListener("submit", onSubmit);
    return () => form?.removeEventListener("submit", onSubmit);
  }, [optional]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * c.width) / r.width,
      y: ((e.clientY - r.top) * c.height) / r.height,
    };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvas.current!.getContext("2d")!;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvas.current!.getContext("2d")!;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    field.current!.value = canvas.current!.toDataURL("image/png");
    setEmpty(false);
    setWarn(false);
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    field.current!.value = "";
    setEmpty(true);
  };

  return (
    <div className="field">
      {label}
      <canvas
        ref={canvas}
        width={600}
        height={180}
        className={`sigpad${warn ? " warn" : ""}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        aria-label={label}
      />
      <input ref={field} type="hidden" name={name} defaultValue="" />
      <span className="row">
        {warn ? <span className="small error">{requiredMessage}</span> : null}
        {!empty ? (
          <button type="button" className="link" onClick={clear}>
            {clearLabel}
          </button>
        ) : null}
      </span>
    </div>
  );
}

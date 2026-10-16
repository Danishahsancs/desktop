import { useEffect, useRef, useState } from "react";
import { KawarpEngine } from "../engine/kawarpEngine";
import { getCoverElement, useCoverElement } from "@/features/covers";

interface KawarpWrapperProps {
  src?: string;
  onLoad?: () => void;
  onError?: (err: Error) => void;
}

export function KawarpWrapper({ src, onLoad, onError }: KawarpWrapperProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<KawarpEngine | null>(null);
  const [loaded, setLoaded] = useState(false);
  // bumped when a lost webgl context is restored, to rebuild the engine
  const [generation, setGeneration] = useState(0);
  const coverElement = useCoverElement(src);

  // mobile gpus drop webgl contexts when the app is backgrounded or memory is
  // tight. hide the canvas (the css blur behind it takes over) and rebuild on
  // restore instead of leaving a frozen/black frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onLost = (e: Event) => {
      e.preventDefault();
      setLoaded(false);
    };
    const onRestored = () => setGeneration((g) => g + 1);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let engine: KawarpEngine | null = null;
    try {
      engine = new KawarpEngine(canvas, {
        warpIntensity: 1.1,
        blurPasses: 8,
        transitionDuration: 1000,
        animationSpeed: 1.0,
        saturation: 1.3,
        scale: 1.18,
        dithering: 0.008,
      });
      engineRef.current = engine;
      engine.start();
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    return () => {
      engine?.dispose();
      engineRef.current = null;
    };
  }, [onError, generation]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const width = Math.round(rect.width * dpr);
      const height = Math.round(rect.height * dpr);

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        engineRef.current?.resize();
      }
    };

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);
    window.addEventListener("resize", updateSize, { passive: true });
    updateSize();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !src) return;

    let isCancelled = false;
    const element = coverElement || getCoverElement(src);

    engine
      .loadImage(src, element)
      .then(() => {
        if (isCancelled) return;
        setLoaded(true);
        onLoad?.();
      })
      .catch((err) => {
        if (isCancelled) return;
        onError?.(err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      isCancelled = true;
    };
  }, [src, coverElement, onLoad, onError, generation]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full block transition-opacity duration-500 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}

export default KawarpWrapper;

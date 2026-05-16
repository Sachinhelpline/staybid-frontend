// ────────────────────────────────────────────────────────────────────────────
// Client-side image resize before upload.
//
// Why: phone cameras shoot 12-48 MP photos (3-8 MB JPEGs). When a hotel
// partner uploads a property image, that full-resolution file lands in
// Supabase Storage and gets served to every subsequent listing visitor.
// Across millions of card renders, each unnecessary MB compounds.
//
// What this does: draws the source image onto a canvas capped at maxDim
// (default 1600px on the longer edge), preserves aspect ratio, re-encodes
// at 80% JPEG quality. Typical 5 MB phone JPEG → ~350-500 KB. PNG inputs
// stay PNG (preserves transparency). HEIC/AVIF/WebP get re-encoded to JPEG.
//
// SAFE FALLBACK: any error path (canvas blocked, decode failure, oversized
// image) returns the original file untouched so uploads always succeed.
// ────────────────────────────────────────────────────────────────────────────

export type ResizeOpts = {
  /** Max length of the longer edge in px. Default 1600. */
  maxDim?: number;
  /** JPEG quality 0-1. Default 0.8. */
  quality?: number;
  /** Skip resize if file is already smaller than this many bytes. Default 300 KB. */
  skipUnderBytes?: number;
};

export async function resizeImageBeforeUpload(file: File, opts: ResizeOpts = {}): Promise<File> {
  const { maxDim = 1600, quality = 0.8, skipUnderBytes = 300 * 1024 } = opts;

  // Server-side or no canvas → return original.
  if (typeof window === "undefined" || typeof document === "undefined") return file;

  // Non-image files: pass through untouched.
  if (!file.type.startsWith("image/")) return file;

  // SVG: vector, doesn't need resize. Pass through.
  if (file.type === "image/svg+xml") return file;

  // Already small: skip resize cost.
  if (file.size <= skipUnderBytes) return file;

  try {
    const img = await loadImage(file);
    const { naturalWidth: w, naturalHeight: h } = img;

    // Already small dimensions? Skip.
    if (w <= maxDim && h <= maxDim) {
      // Still re-encode if it's a heavy JPEG over the byte threshold —
      // 80% quality typically halves the bytes with no visible loss.
      if (file.type === "image/jpeg" && file.size > 1024 * 1024) {
        return await canvasToFile(drawToCanvas(img, w, h), file.name, "image/jpeg", quality);
      }
      return file;
    }

    const scale = maxDim / Math.max(w, h);
    const targetW = Math.round(w * scale);
    const targetH = Math.round(h * scale);

    // Preserve PNG transparency, otherwise re-encode as JPEG.
    const preservePng = file.type === "image/png";
    const outType = preservePng ? "image/png" : "image/jpeg";
    const outName = preservePng
      ? file.name.replace(/\.[^.]+$/, ".png")
      : file.name.replace(/\.[^.]+$/, ".jpg");

    return await canvasToFile(drawToCanvas(img, targetW, targetH), outName, outType, quality);
  } catch {
    // Decode failure, canvas blocked, OOM on huge files — silently fall
    // back to original. Upload never fails because of resize.
    return file;
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function drawToCanvas(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  // Quality hint: bicubic-ish smoothing for downscales.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

function canvasToFile(
  canvas: HTMLCanvasElement,
  name: string,
  type: string,
  quality: number,
): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("canvas.toBlob returned null"));
        resolve(new File([blob], name, { type, lastModified: Date.now() }));
      },
      type,
      quality,
    );
  });
}

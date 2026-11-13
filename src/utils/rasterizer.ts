import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerCode from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';
import UTIF from 'utif';
import type { DocumentItem, OcrZone, RenderedPage } from '../types/ocr';

const pdfWorkerBlob = new Blob([pdfWorkerCode], { type: 'application/javascript' });
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(pdfWorkerBlob);

const MAX_CANVAS_EDGE_PX = 3200;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      try {
        if (typeof img.decode === 'function') {
          await img.decode();
        }
      } catch {
        // Proceed even if decode() is unsupported on specific formats
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error('ไม่สามารถโหลดไฟล์ภาพได้'));
    img.src = src;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ภาพได้'));
    reader.readAsDataURL(file);
  });
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function computeClampedDimensions(w: number, h: number): { width: number; height: number } {
  const maxDim = Math.max(w, h);
  if (maxDim <= MAX_CANVAS_EDGE_PX) {
    return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
  }
  const ratio = MAX_CANVAS_EDGE_PX / maxDim;
  return {
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
  };
}

function isCanvasBlank(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  try {
    const stepX = Math.max(1, Math.floor(width / 32));
    const stepY = Math.max(1, Math.floor(height / 32));
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        if (a > 0 && (r < 248 || g < 248 || b < 248)) {
          return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

interface PdfImageLike {
  width?: number;
  height?: number;
  data?: Uint8ClampedArray | Uint8Array;
  kind?: number;
  bitmap?: ImageBitmap;
}

async function tryDrawEmbeddedPdfImages(
  page: pdfjsLib.PDFPageProxy,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): Promise<boolean> {
  try {
    const opList = await page.getOperatorList();
    const imageNames: string[] = [];
    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      if (
        fn === pdfjsLib.OPS.paintImageXObject ||
        fn === pdfjsLib.OPS.paintImageXObjectRepeat
      ) {
        const name = opList.argsArray[i]?.[0];
        if (typeof name === 'string') imageNames.push(name);
      }
    }

    for (const imgName of imageNames) {
      const imgObj = await new Promise<PdfImageLike | null>((resolve) => {
        try {
          if (page.objs.has(imgName)) {
            resolve(page.objs.get(imgName) as PdfImageLike);
            return;
          }
          page.objs.get(imgName, (obj: unknown) => resolve((obj as PdfImageLike) ?? null));
        } catch {
          resolve(null);
        }
      });

      if (!imgObj) continue;

      if (imgObj.bitmap) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imgObj.bitmap, 0, 0, canvas.width, canvas.height);
        return !isCanvasBlank(ctx, canvas.width, canvas.height);
      }

      if (imgObj.width && imgObj.height && imgObj.data) {
        const tmp = document.createElement('canvas');
        tmp.width = imgObj.width;
        tmp.height = imgObj.height;
        const tctx = tmp.getContext('2d');
        if (!tctx) continue;

        const imgData = tctx.createImageData(imgObj.width, imgObj.height);
        const src = imgObj.data;
        const dst = imgData.data;
        const pixelCount = imgObj.width * imgObj.height;

        if (src.length === pixelCount * 4) {
          dst.set(src);
        } else if (src.length === pixelCount * 3) {
          for (let p = 0, s = 0, d = 0; p < pixelCount; p++, s += 3, d += 4) {
            dst[d] = src[s];
            dst[d + 1] = src[s + 1];
            dst[d + 2] = src[s + 2];
            dst[d + 3] = 255;
          }
        } else if (src.length === pixelCount) {
          for (let p = 0, d = 0; p < pixelCount; p++, d += 4) {
            const v = src[p];
            dst[d] = v;
            dst[d + 1] = v;
            dst[d + 2] = v;
            dst[d + 3] = 255;
          }
        } else {
          continue;
        }

        tctx.putImageData(imgData, 0, 0);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
        if (!isCanvasBlank(ctx, canvas.width, canvas.height)) {
          return true;
        }
      }
    }
  } catch {
    // Ignore fallback error
  }
  return false;
}

export async function rasterizeFile(
  file: File,
  relativePath: string,
  dpi: 150 | 200 | 300
): Promise<DocumentItem> {
  const lowerName = file.name.toLowerCase();
  const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
  const isTiff =
    file.type === 'image/tiff' ||
    lowerName.endsWith('.tif') ||
    lowerName.endsWith('.tiff');

  if (isPdf) {
    const rawBuffer = await file.arrayBuffer();
    const isFileProtocol =
      typeof window !== 'undefined' && window.location.protocol === 'file:';
    const origin =
      typeof window !== 'undefined' && window.location.origin !== 'null'
        ? window.location.origin
        : '';

    const assetUrls =
      !isFileProtocol && origin
        ? {
            cMapUrl: `${origin}/pdfjs/cmaps/`,
            cMapPacked: true,
            iccUrl: `${origin}/pdfjs/iccs/`,
            standardFontDataUrl: `${origin}/pdfjs/standard_fonts/`,
            wasmUrl: `${origin}/pdfjs/wasm/`,
          }
        : {};

    const loadPdf = (useWasm: boolean) =>
      pdfjsLib.getDocument({
        data: rawBuffer.slice(0),
        useWasm,
        useWorkerFetch: false,
        isOffscreenCanvasSupported: false,
        isImageDecoderSupported: false,
        ...assetUrls,
      }).promise;

    const pdf = await loadPdf(true);
    let fallbackPdf: pdfjsLib.PDFDocumentProxy | null = null;
    const pages: RenderedPage[] = [];
    const desiredScale = dpi / 72;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });

      // Normalize physical mm if a scanner stored pixel coordinates as PDF points
      let widthMm = Number(((baseViewport.width * 25.4) / 72).toFixed(1));
      let heightMm = Number(((baseViewport.height * 25.4) / 72).toFixed(1));
      if (widthMm > 600 || heightMm > 850) {
        const aspect = baseViewport.height / Math.max(1, baseViewport.width);
        widthMm = 210;
        heightMm = Number((210 * aspect).toFixed(1));
      }

      // Clamp scale so giant scanner PDFs never exceed browser Canvas limits (which causes blank white output)
      const maxBaseEdge = Math.max(baseViewport.width, baseViewport.height, 1);
      const maxAllowedScale = MAX_CANVAS_EDGE_PX / maxBaseEdge;
      const safeScale = Math.min(desiredScale, maxAllowedScale);

      const viewport = page.getViewport({ scale: safeScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas 2D context unavailable');

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: ctx,
        viewport,
        canvas,
      }).promise;

      // Rescue blank scanned PDF pages (e.g. failed WASM JBIG2/JPX, print intent, or embedded image XObjects)
      if (isCanvasBlank(ctx, canvas.width, canvas.height)) {
        const retryViewport = page.getViewport({
          scale: Math.min(safeScale, 1.5),
        });
        canvas.width = Math.max(1, Math.round(retryViewport.width));
        canvas.height = Math.max(1, Math.round(retryViewport.height));
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvasContext: ctx,
          viewport: retryViewport,
          canvas,
          intent: 'print',
        }).promise;

        if (isCanvasBlank(ctx, canvas.width, canvas.height)) {
          // Pure-JS no-WASM fallback for scanned PDFs when WASM fails
          try {
            if (!fallbackPdf) {
              fallbackPdf = await loadPdf(false);
            }
            const fbPage = await fallbackPdf.getPage(pageNum);
            const fbViewport = fbPage.getViewport({ scale: Math.min(safeScale, 1.8) });
            canvas.width = Math.max(1, Math.round(fbViewport.width));
            canvas.height = Math.max(1, Math.round(fbViewport.height));
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await fbPage.render({
              canvasContext: ctx,
              viewport: fbViewport,
              canvas,
            }).promise;
          } catch {
            // Proceed to embedded XObject fallback below
          }
        }

        if (isCanvasBlank(ctx, canvas.width, canvas.height)) {
          await tryDrawEmbeddedPdfImages(page, canvas, ctx);
        }
      }

      pages.push({
        pageNumber: pageNum,
        widthPx: canvas.width,
        heightPx: canvas.height,
        widthMm,
        heightMm,
        dataUrl: canvas.toDataURL('image/png'),
      });
    }

    return {
      id: createId('doc'),
      name: file.name,
      relativePath: relativePath || file.name,
      sourceType: 'pdf',
      fileSize: file.size,
      dpi,
      pages,
      status: 'ready',
    };
  }

  // Multi-page or single-page TIFF scanner file support
  if (isTiff) {
    const buffer = await file.arrayBuffer();
    const ifds = UTIF.decode(buffer);
    if (!ifds || ifds.length === 0) {
      throw new Error('ไม่สามารถอ่านไฟล์ TIFF ที่สแกนมาได้');
    }

    const pages: RenderedPage[] = [];
    for (let i = 0; i < ifds.length; i++) {
      const ifd = ifds[i];
      UTIF.decodeImage(buffer, ifd);
      const rgba = UTIF.toRGBA8(ifd);
      const srcW = ifd.width;
      const srcH = ifd.height;

      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = srcW;
      srcCanvas.height = srcH;
      const sctx = srcCanvas.getContext('2d');
      if (!sctx) throw new Error('Canvas 2D context unavailable');
      const imgData = sctx.createImageData(srcW, srcH);
      imgData.data.set(rgba);
      sctx.putImageData(imgData, 0, 0);

      const { width, height } = computeClampedDimensions(srcW, srcH);
      const outCanvas = document.createElement('canvas');
      outCanvas.width = width;
      outCanvas.height = height;
      const octx = outCanvas.getContext('2d');
      if (!octx) throw new Error('Canvas 2D context unavailable');
      octx.fillStyle = '#FFFFFF';
      octx.fillRect(0, 0, width, height);
      octx.drawImage(srcCanvas, 0, 0, width, height);

      const widthMm = 210;
      const heightMm = Number(((height / width) * widthMm).toFixed(1));
      pages.push({
        pageNumber: i + 1,
        widthPx: width,
        heightPx: height,
        widthMm,
        heightMm,
        dataUrl: outCanvas.toDataURL('image/png'),
      });
    }

    return {
      id: createId('doc'),
      name: file.name,
      relativePath: relativePath || file.name,
      sourceType: 'image',
      fileSize: file.size,
      dpi,
      pages,
      status: 'ready',
    };
  }

  // Standard Scanned Image file path (PNG, JPG, WebP, BMP, JFIF, AVIF, etc.)
  let bitmap: ImageBitmap | null = null;
  if (typeof createImageBitmap === 'function') {
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      bitmap = null;
    }
  }

  if (bitmap) {
    try {
      const { width, height } = computeClampedDimensions(bitmap.width, bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);

      const widthMm = 210;
      const heightMm = Number(((height / width) * widthMm).toFixed(1));
      const dataUrl = canvas.toDataURL('image/png');

      return {
        id: createId('doc'),
        name: file.name,
        relativePath: relativePath || file.name,
        sourceType: 'image',
        fileSize: file.size,
        dpi,
        pages: [
          {
            pageNumber: 1,
            widthPx: width,
            heightPx: height,
            widthMm,
            heightMm,
            dataUrl,
          },
        ],
        status: 'ready',
      };
    } finally {
      bitmap.close();
    }
  }

  // Fallback path using FileReader + Image.decode()
  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(rawDataUrl);
  const srcW = img.naturalWidth || img.width || 1654;
  const srcH = img.naturalHeight || img.height || 2339;
  const { width, height } = computeClampedDimensions(srcW, srcH);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  let finalDataUrl = canvas.toDataURL('image/png');
  if (!finalDataUrl || finalDataUrl === 'data:,') {
    finalDataUrl = rawDataUrl;
  }

  const widthMm = 210;
  const heightMm = Number(((height / width) * widthMm).toFixed(1));

  return {
    id: createId('doc'),
    name: file.name,
    relativePath: relativePath || file.name,
    sourceType: 'image',
    fileSize: file.size,
    dpi,
    pages: [
      {
        pageNumber: 1,
        widthPx: width,
        heightPx: height,
        widthMm,
        heightMm,
        dataUrl: finalDataUrl,
      },
    ],
    status: 'ready',
  };
}

export async function rotatePageClockwise(page: RenderedPage): Promise<RenderedPage> {
  const img = await loadImage(page.dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = page.heightPx;
  canvas.height = page.widthPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, -page.widthPx / 2, -page.heightPx / 2);

  return {
    ...page,
    widthPx: page.heightPx,
    heightPx: page.widthPx,
    widthMm: page.heightMm,
    heightMm: page.widthMm,
    dataUrl: canvas.toDataURL('image/png'),
  };
}

function applyImageFilters(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: { grayscale: boolean; contrastBoost: boolean }
) {
  if (!options.grayscale && !options.contrastBoost) return;
  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;
  const contrastFactor = options.contrastBoost ? 1.45 : 1;

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];

    if (options.grayscale) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = lum;
    }

    if (options.contrastBoost) {
      r = Math.min(255, Math.max(0, contrastFactor * (r - 128) + 128));
      g = Math.min(255, Math.max(0, contrastFactor * (g - 128) + 128));
      b = Math.min(255, Math.max(0, contrastFactor * (b - 128) + 128));
    }

    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }

  ctx.putImageData(imgData, 0, 0);
}

export async function cropZoneImage(
  page: RenderedPage,
  zone: OcrZone,
  options: { grayscale: boolean; contrastBoost: boolean }
): Promise<string> {
  const img = await loadImage(page.dataUrl);
  const sx = Math.max(0, Math.round(zone.xRatio * page.widthPx));
  const sy = Math.max(0, Math.round(zone.yRatio * page.heightPx));
  const sw = Math.max(8, Math.min(page.widthPx - sx, Math.round(zone.wRatio * page.widthPx)));
  const sh = Math.max(8, Math.min(page.heightPx - sy, Math.round(zone.hRatio * page.heightPx)));

  // Upscale small crops slightly for sharper OCR recognition on tiny text
  const upscale = sw < 280 || sh < 80 ? 2 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = sw * upscale;
  canvas.height = sh * upscale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  applyImageFilters(ctx, canvas.width, canvas.height, options);
  return canvas.toDataURL('image/png');
}

export async function preprocessFullPageImage(
  page: RenderedPage,
  options: { grayscale: boolean; contrastBoost: boolean }
): Promise<string> {
  if (!options.grayscale && !options.contrastBoost) {
    return page.dataUrl;
  }
  const img = await loadImage(page.dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = page.widthPx;
  canvas.height = page.heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(img, 0, 0);
  applyImageFilters(ctx, canvas.width, canvas.height, options);
  return canvas.toDataURL('image/png');
}

/**
 * Ensures image data URLs sent to Cloud API routes stay safely under serverless body limits (e.g. Vercel 4.5 MB).
 */
export async function compressImageForApi(
  dataUrl: string,
  maxChars = 2_600_000
): Promise<{ dataUrl: string; mimeType: string }> {
  const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
  const currentMime = mimeMatch?.[1] || 'image/png';
  if (dataUrl.length <= maxChars) {
    return { dataUrl, mimeType: currentMime };
  }

  const img = await loadImage(dataUrl);
  const srcW = img.naturalWidth || img.width || 1654;
  const srcH = img.naturalHeight || img.height || 2339;

  const tryEncode = (maxEdge: number, quality: number): string => {
    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH, 1));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  };

  const attempts: Array<[number, number]> = [
    [2200, 0.88],
    [2000, 0.78],
    [1800, 0.7],
    [1500, 0.65],
  ];

  let latest = dataUrl;
  for (const [edge, quality] of attempts) {
    latest = tryEncode(edge, quality);
    if (latest.length <= maxChars) {
      return { dataUrl: latest, mimeType: 'image/jpeg' };
    }
  }

  return { dataUrl: latest, mimeType: 'image/jpeg' };
}

type WebkitEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (success: (f: File) => void, error?: (err: unknown) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: WebkitEntry[]) => void, error?: (err: unknown) => void) => void;
  };
};

async function traverseEntry(
  entry: WebkitEntry,
  out: Array<{ file: File; relativePath: string }>
): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => {
      entry.file!(resolve, reject);
    });
    const rel = entry.fullPath.startsWith('/') ? entry.fullPath.slice(1) : entry.fullPath;
    out.push({ file, relativePath: rel });
    return;
  }

  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const readBatch = (): Promise<WebkitEntry[]> =>
      new Promise((resolve, reject) => reader.readEntries(resolve, reject));

    let entries: WebkitEntry[] = [];
    while (true) {
      const batch = await readBatch();
      if (batch.length === 0) break;
      entries = entries.concat(batch);
    }

    for (const child of entries) {
      await traverseEntry(child, out);
    }
  }
}

export function isSupportedDocumentFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return (
    file.type === 'application/pdf' ||
    lower.endsWith('.pdf') ||
    file.type.startsWith('image/') ||
    /\.(png|jpe?g|webp|bmp|gif|tif|tiff|jfif|avif)$/i.test(lower)
  );
}

export async function collectFilesFromDrop(
  dataTransfer: DataTransfer
): Promise<Array<{ file: File; relativePath: string }>> {
  const items = Array.from(dataTransfer.items || []);
  const collected: Array<{ file: File; relativePath: string }> = [];

  const hasEntries = items.some(
    (item) => typeof (item as unknown as { webkitGetAsEntry?: () => WebkitEntry | null }).webkitGetAsEntry === 'function'
  );

  if (hasEntries) {
    for (const item of items) {
      const entry = (
        item as unknown as { webkitGetAsEntry?: () => WebkitEntry | null }
      ).webkitGetAsEntry?.();
      if (entry) {
        await traverseEntry(entry, collected);
      }
    }
  } else {
    for (const file of Array.from(dataTransfer.files)) {
      collected.push({ file, relativePath: file.name });
    }
  }

  return collected.filter((item) => isSupportedDocumentFile(item.file));
}

/**
 * Generates a clean, crisp A4 sample Thai Export Customs Declaration ("ใบขนสินค้าขาออก")
 * rendered purely as a raster image (no text layer!) along with matching preset zones.
 */
export function generateSampleCustomsDocument(): {
  doc: DocumentItem;
  presetZones: OcrZone[];
} {
  // 200 DPI A4: 1654 x 2339 px (210 x 297 mm)
  const W = 1654;
  const H = 2339;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // White paper background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  const mmToPx = (mm: number) => (mm / 210) * W;

  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 2;

  // Title
  ctx.fillStyle = '#1E40AF';
  ctx.font = 'bold 42px "Noto Sans Thai", "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ใบขนสินค้าขาออก (EXPORT DECLARATION)', mmToPx(88), mmToPx(24));

  // Barcode box top right
  const bcX = mmToPx(134);
  const bcY = mmToPx(14);
  ctx.fillStyle = '#0F172A';
  const bars = [4, 2, 6, 2, 4, 8, 2, 4, 2, 6, 4, 2, 8, 2, 4, 2, 6, 2, 4, 4, 2, 6, 4, 2, 4, 6, 2, 4, 8, 2, 4, 2, 6, 2, 4];
  let bx = bcX + 10;
  for (let i = 0; i < bars.length; i++) {
    const bw = bars[i];
    if (i % 2 === 0) {
      ctx.fillRect(bx, bcY, bw * 2.2, 64);
    }
    bx += bw * 2.4;
  }
  ctx.font = 'bold 24px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('A0021691013484', bcX + 170, bcY + 92);

  ctx.textAlign = 'left';

  // Grid helper
  const drawBox = (xMm: number, yMm: number, wMm: number, hMm: number) => {
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mmToPx(xMm), mmToPx(yMm), mmToPx(wMm), mmToPx(hMm));
  };

  const drawLabel = (text: string, xMm: number, yMm: number) => {
    ctx.fillStyle = '#1D4ED8';
    ctx.font = 'bold 20px "Noto Sans Thai", sans-serif';
    ctx.fillText(text, mmToPx(xMm), mmToPx(yMm));
  };

  const drawValue = (text: string, xMm: number, yMm: number, size = 23, bold = false) => {
    ctx.fillStyle = '#0F172A';
    ctx.font = `${bold ? 'bold ' : ''}${size}px "Noto Sans Thai", "Plus Jakarta Sans", sans-serif`;
    ctx.fillText(text, mmToPx(xMm), mmToPx(yMm));
  };

  // Row 1: Shipper | Tax ID | Doc Type & INV
  drawBox(12, 30, 88, 30);
  drawBox(100, 30, 32, 30);
  drawBox(132, 30, 66, 30);

  drawLabel('ผู้ส่งของออก (ชื่อและที่อยู่ หรือรหัส)', 14, 35);
  drawValue('FORD MOTOR COMPANY (THAILAND) LIMITED', 14, 41, 22, true);
  drawValue('บริษัท ฟอร์ด มอเตอร์ คัมปะนี (ประเทศไทย) จำกัด', 14, 47, 22);
  drawValue('500/103 หมู่ที่ 3 ตำบลตาสิทธิ์ อำเภอปลวกแดง จังหวัดระยอง 21140', 14, 53, 19);

  drawLabel('เลขประจำตัวผู้เสียภาษีอากร', 102, 35);
  drawValue('0205552019034', 102, 42, 23, true);

  drawLabel('ประเภทเอกสาร', 134, 35);
  drawValue('020 : ใบขนสินค้าขาออก เขตปลอดอากร', 134, 41, 20, true);
  drawValue('ใช้สิทธิ์ประโยชน์ / BOI', 134, 47, 20);
  drawValue('บัญชีราคาสินค้า : 00000212638   วันที่ : 02/10/2026', 134, 54, 20, true);

  // Row 2: Customs Status
  drawBox(12, 60, 120, 14);
  drawBox(132, 60, 66, 14);
  drawValue('ชื่อและเลขที่บัตรผ่านพิธีการ: N/A   ทะเบียนเลขที่: N/A', 14, 68, 20);
  drawValue('สั่งการตรวจ: ACCEPT    02/10/2026 14:49:38 : DEC', 134, 68, 20, true);

  // Row 3: Export Agent | Duty
  drawBox(12, 74, 120, 22);
  drawBox(132, 74, 66, 22);
  drawLabel('ตัวแทนออกของ', 14, 79);
  drawValue('บริษัท เอพีแอล โลจิสติคส์ เอสวีซีเอส (ประเทศไทย) จำกัด', 14, 86, 21, true);
  drawValue('APL Logistics Svcs (Thailand) Ltd.  0105542016277', 14, 92, 19);
  drawValue('อากรขาออก  0.00  THB', 145, 86, 23, true);

  // Row 4: Vessel | Export Tax Incentives ID
  drawBox(12, 96, 68, 18);
  drawBox(80, 96, 118, 18);
  drawLabel('ชื่อยานพาหนะ / เที่ยวเรือ', 14, 101);
  drawValue('XIN MING ZHOU 98 (2613N)', 14, 109, 23, true);
  drawValue('Export Tax Incentives ID: F5302180160003', 83, 106, 21);

  // Row 5: Mode of Transport | ETD | Insurance
  drawBox(12, 114, 68, 18);
  drawBox(80, 114, 52, 18);
  drawBox(132, 114, 66, 18);
  drawLabel('ส่งออกโดยทาง', 14, 119);
  drawValue('ส่งออกโดยทาง เรือ (SEA)', 14, 127, 22, true);
  drawLabel('วันที่ส่งออก (ETD)', 82, 119);
  drawValue('22/10/2569', 82, 127, 24, true);
  drawLabel('เงื่อนไขการชำระอากร', 134, 119);
  drawValue('ยกเว้นอากร (Exempted)', 134, 127, 21);

  // Row 6: Port of Release | Port of Loading | Destination Country
  drawBox(12, 132, 68, 18);
  drawBox(80, 132, 52, 18);
  drawBox(132, 132, 66, 18);
  drawLabel('ท่าเรือที่ตรวจปล่อยของ', 14, 137);
  drawValue('ท่าเรือ กลุ่ม ESCO (สทบ.) 2813', 14, 145, 21, true);
  drawLabel('ท่าเรือที่รับบรรทุกของ', 82, 137);
  drawValue('ท่าเรือแหลมฉบัง 2801', 82, 145, 21, true);
  drawLabel('ขายไปยังประเทศ', 134, 137);
  drawValue('UNITED STATES / US', 134, 145, 22, true);

  // Row 7: Packages & Totals
  drawBox(12, 150, 68, 18);
  drawBox(80, 150, 52, 18);
  drawBox(132, 150, 66, 18);
  drawLabel('จำนวนและลักษณะหีบห่อ', 14, 155);
  drawValue('48  PALLETS (48 PLT)', 14, 163, 22, true);
  drawLabel('น้ำหนักสุทธิ (Net Weight)', 82, 155);
  drawValue('14,250.00  KGM', 82, 163, 22, true);
  drawLabel('ราคา FOB รวม (USD)', 134, 155);
  drawValue('186,420.50  USD', 134, 163, 23, true);

  // Row 8: Line Items Table (Great for Full-Page & Hybrid mode!)
  drawLabel('รายการสินค้า (LINE ITEMS DETAIL)', 12, 177);

  const tableTop = 181;
  const colWidths = [14, 34, 62, 24, 24, 28];
  const headers = ['ลำดับ', 'พิกัดศุลกากร', 'รายละเอียดสินค้า', 'จำนวน', 'น้ำหนัก (KG)', 'มูลค่า (USD)'];
  const rowsData = [
    ['0001', '8708.29.99', 'FRONT BUMPER ASSEMBLY - RANGER T6', '120 PCS', '3,840.00', '48,600.00'],
    ['0002', '8708.99.90', 'REAR AXLE HOUSING BRACKET SET', '240 PCS', '4,910.00', '62,400.00'],
    ['0003', '8409.99.49', 'DIESEL INJECTOR RAIL MODULE 2.0L', '180 PCS', '2,750.00', '44,120.50'],
    ['0004', '8708.30.29', 'DISC BRAKE CALIPER KIT (HEAVY DUTY)', '160 PCS', '2,750.00', '31,300.00'],
  ];

  ctx.fillStyle = '#EFF6FF';
  ctx.fillRect(mmToPx(12), mmToPx(tableTop), mmToPx(186), mmToPx(11));

  let curX = 12;
  for (let c = 0; c < headers.length; c++) {
    drawBox(curX, tableTop, colWidths[c], 11);
    ctx.fillStyle = '#1E3A8A';
    ctx.font = 'bold 20px "Noto Sans Thai", sans-serif';
    ctx.fillText(headers[c], mmToPx(curX + 2), mmToPx(tableTop + 7.5));
    curX += colWidths[c];
  }

  for (let r = 0; r < rowsData.length; r++) {
    const rowY = tableTop + 11 + r * 12;
    curX = 12;
    for (let c = 0; c < headers.length; c++) {
      drawBox(curX, rowY, colWidths[c], 12);
      ctx.fillStyle = '#0F172A';
      ctx.font = '20px "Noto Sans Thai", "JetBrains Mono", sans-serif';
      ctx.fillText(rowsData[r][c], mmToPx(curX + 2), mmToPx(rowY + 8));
      curX += colWidths[c];
    }
  }

  ctx.fillStyle = '#64748B';
  ctx.font = '18px "Noto Sans Thai", sans-serif';
  ctx.fillText('เอกสารตัวอย่างสำหรับทดสอบการถอดภาพ OCR (Rasterized Image Sample - No Embedded Text)', mmToPx(12), mmToPx(265));

  const dataUrl = canvas.toDataURL('image/png');
  const docId = createId('sample');

  const mmBox = (
    id: string,
    label: string,
    dataType: OcrZone['dataType'],
    xMm: number,
    yMm: number,
    wMm: number,
    hMm: number
  ): OcrZone => ({
    id,
    label,
    dataType,
    xRatio: xMm / 210,
    yRatio: yMm / 297,
    wRatio: wMm / 210,
    hRatio: hMm / 297,
    pageScope: 'all',
  });

  const presetZones: OcrZone[] = [
    mmBox('z_doc_no', 'เลขที่ใบขนสินค้า', 'text', 135, 22, 55, 7),
    mmBox('z_shipper', 'Shipper (ผู้ส่งของออก)', 'text', 13, 37, 84, 12),
    mmBox('z_tax_id', 'Tax ID', 'number', 101, 37, 30, 8),
    mmBox('z_inv_no', 'INV No.', 'text', 148, 50, 22, 6),
    mmBox('z_inv_date', 'INV Date', 'date', 176, 50, 20, 6),
    mmBox('z_vessel', 'Name VS (ชื่อยานพาหนะ)', 'text', 13, 103, 60, 8),
    mmBox('z_transport', 'ส่งออกโดยทาง', 'text', 13, 121, 56, 8),
    mmBox('z_etd', 'ETD (วันที่ส่งออก)', 'date', 81, 121, 32, 8),
    mmBox('z_port_release', 'ท่าเรือตรวจปล่อย', 'text', 13, 139, 60, 8),
    mmBox('z_fob_total', 'มูลค่า FOB รวม', 'number', 133, 157, 46, 8),
  ];

  return {
    doc: {
      id: docId,
      name: 'sample_export_declaration_2813.png',
      relativePath: 'samples/ใบขนสินค้าขาออก/sample_export_declaration_2813.png',
      sourceType: 'image',
      fileSize: Math.round(dataUrl.length * 0.75),
      dpi: 200,
      pages: [
        {
          pageNumber: 1,
          widthPx: W,
          heightPx: H,
          widthMm: 210,
          heightMm: 297,
          dataUrl,
        },
      ],
      status: 'ready',
    },
    presetZones,
  };
}

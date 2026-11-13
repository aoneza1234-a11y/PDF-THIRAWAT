import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { DocumentItem, OcrZone, RenderedPage } from '../types/ocr';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('ไม่สามารถโหลดภาพได้'));
    img.src = src;
  });
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function rasterizeFile(
  file: File,
  relativePath: string,
  dpi: 150 | 200 | 300
): Promise<DocumentItem> {
  const isPdf =
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const pages: RenderedPage[] = [];
    const scale = dpi / 72;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const widthMm = Number(((baseViewport.width * 25.4) / 72).toFixed(1));
      const heightMm = Number(((baseViewport.height * 25.4) / 72).toFixed(1));

      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: ctx,
        viewport,
        canvas,
      }).promise;

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

  // Image file path (PNG, JPG, WebP, BMP, etc.)
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    // Map image width proportionally assuming standard A4 width (210mm) when high-res, or pixel-to-mm
    const widthMm = 210;
    const heightMm = Number(((canvas.height / canvas.width) * widthMm).toFixed(1));

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
          widthPx: canvas.width,
          heightPx: canvas.height,
          widthMm,
          heightMm,
          dataUrl: canvas.toDataURL('image/png'),
        },
      ],
      status: 'ready',
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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
    /\.(png|jpe?g|webp|bmp|gif)$/i.test(lower)
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

  // Outer form frame
  const left = mmToPx(12);
  const top = mmToPx(14);
  const formW = mmToPx(186);

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
  const colWidths = [14, 34, 62, 24, 24, 28]; // Sum = 186mm
  const headers = ['ลำดับ', 'พิกัดศุลกากร', 'รายละเอียดสินค้า', 'จำนวน', 'น้ำหนัก (KG)', 'มูลค่า (USD)'];
  const rowsData = [
    ['0001', '8708.29.99', 'FRONT BUMPER ASSEMBLY - RANGER T6', '120 PCS', '3,840.00', '48,600.00'],
    ['0002', '8708.99.90', 'REAR AXLE HOUSING BRACKET SET', '240 PCS', '4,910.00', '62,400.00'],
    ['0003', '8409.99.49', 'DIESEL INJECTOR RAIL MODULE 2.0L', '180 PCS', '2,750.00', '44,120.50'],
    ['0004', '8708.30.29', 'DISC BRAKE CALIPER KIT (HEAVY DUTY)', '160 PCS', '2,750.00', '31,300.00'],
  ];

  // Header fill
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

  // Footer stamp note
  ctx.fillStyle = '#64748B';
  ctx.font = '18px "Noto Sans Thai", sans-serif';
  ctx.fillText('เอกสารตัวอย่างสำหรับทดสอบการถอดภาพ OCR (Rasterized Image Sample - No Embedded Text)', mmToPx(12), mmToPx(265));

  // Keep unused variable quiet
  void left;
  void top;
  void formW;

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

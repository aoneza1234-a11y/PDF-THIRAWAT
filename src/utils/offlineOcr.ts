import { createWorker, type Worker } from 'tesseract.js';

let cachedWorker: Worker | null = null;
let workerInitPromise: Promise<Worker> | null = null;

export async function getOfflineOcrWorker(
  onProgress?: (status: string, progress: number) => void
): Promise<Worker> {
  if (cachedWorker) return cachedWorker;
  if (workerInitPromise) return workerInitPromise;

  workerInitPromise = (async () => {
    const worker = await createWorker('tha+eng', 1, {
      logger: (m) => {
        if (onProgress && typeof m.progress === 'number') {
          onProgress(m.status || 'กำลังเตรียมเอนจิน OCR...', m.progress);
        }
      },
    });
    cachedWorker = worker;
    return worker;
  })();

  try {
    return await workerInitPromise;
  } catch (err) {
    workerInitPromise = null;
    throw err;
  }
}

export async function preloadOfflineLanguagePack(
  onProgress?: (status: string, progress: number) => void
): Promise<void> {
  await getOfflineOcrWorker(onProgress);
}

export async function runOfflineZonesOcr(
  zones: Array<{
    zoneId: string;
    label: string;
    dataType: string;
    imageBase64: string;
  }>,
  onProgress?: (status: string, progress: number) => void
): Promise<{
  results: Record<string, { text: string; confidence: 'high' | 'medium' | 'low' }>;
}> {
  const worker = await getOfflineOcrWorker(onProgress);
  const results: Record<
    string,
    { text: string; confidence: 'high' | 'medium' | 'low' }
  > = {};

  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (onProgress) {
      onProgress(`กำลังอ่านกรอบ "${z.label}" (${i + 1}/${zones.length})`, i / zones.length);
    }
    const { data } = await worker.recognize(z.imageBase64);
    const cleaned = (data.text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(z.dataType === 'table' ? '\n' : ' ')
      .trim();

    const confScore = data.confidence ?? 0;
    const confidence: 'high' | 'medium' | 'low' =
      confScore >= 75 ? 'high' : confScore >= 45 ? 'medium' : 'low';

    results[z.zoneId] = {
      text: cleaned,
      confidence,
    };
  }

  return { results };
}

export async function runOfflineFullPageOcr(
  imageBase64: string,
  mode: 'full-table' | 'full-lines' | 'hybrid-table',
  onProgress?: (status: string, progress: number) => void
): Promise<{
  documentTitle: string;
  keyValues: Array<{ key: string; value: string }>;
  tables: Array<{ tableName: string; headers: string[]; rows: string[][] }>;
  lines: Array<{ lineNo: number; cells: string[] }>;
}> {
  const worker = await getOfflineOcrWorker(onProgress);
  const { data } = await worker.recognize(imageBase64);

  const rawLines = (data.text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const parsedLines = rawLines.map((lineText, idx) => {
    const cells = lineText
      .split(/\s{2,}|\t|\|/)
      .map((c) => c.trim())
      .filter(Boolean);
    return {
      lineNo: idx + 1,
      cells: cells.length > 0 ? cells : [lineText],
    };
  });

  if (mode === 'full-lines') {
    return {
      documentTitle: rawLines[0] || 'Offline OCR Document',
      keyValues: [],
      tables: [],
      lines: parsedLines,
    };
  }

  const keyValues: Array<{ key: string; value: string }> = [];
  const tableCandidates: string[][] = [];

  for (const line of rawLines) {
    if (line.includes(':') && !/\s{3,}/.test(line)) {
      const [k, ...rest] = line.split(':');
      const val = rest.join(':').trim();
      if (k.trim() && val) {
        keyValues.push({ key: k.trim(), value: val });
        continue;
      }
    }
    const cols = line
      .split(/\s{2,}|\t|\|/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (cols.length >= 2) {
      tableCandidates.push(cols);
    }
  }

  const tables: Array<{ tableName: string; headers: string[]; rows: string[][] }> = [];
  if (tableCandidates.length >= 2) {
    const headers = tableCandidates[0];
    const colCount = headers.length;
    const rows = tableCandidates.slice(1).map((r) => {
      const padded = [...r];
      while (padded.length < colCount) padded.push('');
      return padded.slice(0, colCount);
    });
    tables.push({
      tableName: 'ตารางที่ถอดได้ (Offline OCR)',
      headers,
      rows,
    });
  } else if (parsedLines.length > 0) {
    tables.push({
      tableName: 'ข้อความทั้งหมด (Offline OCR)',
      headers: ['บรรทัด', 'ข้อความ'],
      rows: parsedLines.map((l) => [String(l.lineNo), l.cells.join(' ')]),
    });
  }

  return {
    documentTitle: rawLines[0] || 'Offline OCR Document',
    keyValues,
    tables,
    lines: parsedLines,
  };
}

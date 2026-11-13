async function extractNonJsonError(
  resp: Response,
  rawText: string,
  fallbackError: string
): Promise<string> {
  const trimmed = rawText.trim();
  const lower = trimmed.toLowerCase();

  if (resp.status === 413 || lower.includes('entity too large') || lower.includes('body exceeded')) {
    return 'ภาพเอกสารมีขนาดใหญ่เกินขีดจำกัดเซิร์ฟเวอร์ (4.5 MB) กรุณาลดค่า DPI ที่แถบซ้าย หรือสลับเป็นโหมด "Offline ในเครื่อง"';
  }

  if (
    resp.status === 404 &&
    (lower.startsWith('the page c') || lower.includes('not_found') || lower.includes('<!doctype'))
  ) {
    return 'ไม่พบ API Endpoint บนเซิร์ฟเวอร์ (404) — หากใช้งานบน Vercel กรุณาตรวจสอบว่าได้ push โฟลเดอร์ api/, lib/ และไฟล์ vercel.json ขึ้น GitHub แล้ว หรือสลับใช้โหมด "Offline ในเครื่อง"';
  }

  if (resp.status === 502 || resp.status === 504 || lower.includes('timeout')) {
    return 'เซิร์ฟเวอร์ประมวลผลเกินเวลาที่กำหนด (Timeout) กรุณาสแกนทีละหน้าน้อยลง หรือใช้โหมด "Offline ในเครื่อง"';
  }

  if (lower.startsWith('<!doctype') || lower.startsWith('<html')) {
    return `${fallbackError} (เซิร์ฟเวอร์ส่งหน้า HTML กลับมาแทน JSON · HTTP ${resp.status})`;
  }

  if (trimmed) {
    return `${fallbackError} (HTTP ${resp.status}: ${trimmed.slice(0, 160)})`;
  }

  return `${fallbackError} (HTTP ${resp.status})`;
}

export async function parseJsonResponse<T>(
  resp: Response,
  fallbackError: string
): Promise<T> {
  const rawText = await resp.text();
  let parsed: unknown = null;
  let isValidJson = false;

  if (rawText.trim()) {
    try {
      parsed = JSON.parse(rawText);
      isValidJson = true;
    } catch {
      isValidJson = false;
    }
  }

  if (!isValidJson) {
    throw new Error(await extractNonJsonError(resp, rawText, fallbackError));
  }

  if (!resp.ok) {
    const errObj = parsed as { error?: string; message?: string } | null;
    throw new Error(errObj?.error || errObj?.message || `${fallbackError} (HTTP ${resp.status})`);
  }

  return parsed as T;
}

export async function postJson<T>(
  url: string,
  payload: unknown,
  fallbackError: string
): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<T>(resp, fallbackError);
}

export async function postForBlob(
  url: string,
  payload: unknown,
  fallbackError: string
): Promise<Blob> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    await parseJsonResponse<unknown>(resp, fallbackError);
  }

  return resp.blob();
}

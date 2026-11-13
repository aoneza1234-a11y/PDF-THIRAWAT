import { runZonesOcr, type ZoneInput } from "../../lib/ocrService.js";

interface ApiRequest {
  method?: string;
  body?: {
    zones?: ZoneInput[];
    languageHint?: string;
  };
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (data: unknown) => void;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const zones = req.body?.zones ?? [];
    if (!Array.isArray(zones) || zones.length === 0) {
      res.status(400).json({ error: "กรุณาส่งรายการพิกัดกรอบ OCR อย่างน้อย 1 กรอบ" });
      return;
    }

    const results = await runZonesOcr(zones, req.body?.languageHint);
    res.status(200).json({ results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาดระหว่างอ่าน OCR";
    console.error("Vercel OCR zones error:", err);
    res.status(500).json({ error: message });
  }
}

import { runFullPageOcr } from "../../lib/ocrService.js";

interface ApiRequest {
  method?: string;
  body?: {
    imageBase64?: string;
    mimeType?: string;
    mode?: "full-table" | "full-lines" | "hybrid-table";
    customHint?: string;
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
    const body = req.body;
    if (!body?.imageBase64) {
      res.status(400).json({ error: "ไม่พบข้อมูลภาพสำหรับประมวลผล OCR" });
      return;
    }

    const data = await runFullPageOcr({
      imageBase64: body.imageBase64,
      mimeType: body.mimeType,
      mode: body.mode ?? "full-table",
      customHint: body.customHint,
    });

    res.status(200).json(data);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "เกิดข้อผิดพลาดระหว่างถอดข้อความทั้งหน้า";
    console.error("Vercel OCR full-page error:", err);
    res.status(500).json({ error: message });
  }
}

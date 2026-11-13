import { buildPortableZipBuffer } from "../lib/exportService.js";

interface ApiRequest {
  method?: string;
  body?: {
    includeCurrentZones?: boolean;
    zones?: unknown[];
    templates?: unknown[];
  };
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  setHeader: (name: string, value: string) => void;
  send: (body: Buffer | string) => void;
  json: (data: unknown) => void;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const zipBuffer = await buildPortableZipBuffer(process.cwd(), req.body);
    const filename = `RasterZone-OCR-Portable-${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(zipBuffer);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถสร้างแพ็กเกจโปรแกรม (.zip) ได้";
    console.error("Vercel export bundle error:", err);
    res.status(500).json({ error: message });
  }
}

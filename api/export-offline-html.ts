import { buildOfflineHtmlString } from "../lib/exportService.js";

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
  send: (body: string) => void;
  json: (data: unknown) => void;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const html = await buildOfflineHtmlString(process.cwd(), {
      ...req.body,
      allowBuildFallback: false,
    });
    const filename = `RasterZone-OCR-Offline-${new Date().toISOString().slice(0, 10)}.html`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(html);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถสร้างเว็บแอปออฟไลน์ได้";
    console.error("Vercel export offline HTML error:", err);
    res.status(500).json({ error: message });
  }
}

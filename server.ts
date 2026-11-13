import express from "express";
import type { Request, Response } from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import {
  runFullPageOcr,
  runZonesOcr,
  type ZoneInput,
} from "./lib/ocrService.ts";
import {
  buildOfflineHtmlString,
  buildPortableZipBuffer,
} from "./lib/exportService.ts";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";

const app = express();
app.use(express.json({ limit: "50mb" }));

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", hasApiKey: Boolean(process.env.GEMINI_API_KEY) });
});

app.post("/api/ocr/zones", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      zones?: ZoneInput[];
      languageHint?: string;
    };

    const zones = body?.zones ?? [];
    if (!Array.isArray(zones) || zones.length === 0) {
      res.status(400).json({ error: "กรุณาส่งรายการพิกัดกรอบ OCR อย่างน้อย 1 กรอบ" });
      return;
    }

    const results = await runZonesOcr(zones, body.languageHint);
    res.json({ results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาดระหว่างอ่าน OCR";
    console.error("OCR zones error:", err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/ocr/full-page", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      imageBase64?: string;
      mimeType?: string;
      mode?: "full-table" | "full-lines" | "hybrid-table";
      customHint?: string;
    };

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
    res.json(data);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "เกิดข้อผิดพลาดระหว่างถอดข้อความทั้งหน้า";
    console.error("OCR full-page error:", err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/export-bundle", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      includeCurrentZones?: boolean;
      zones?: unknown[];
      templates?: unknown[];
    };

    const zipBuffer = await buildPortableZipBuffer(__dirname, body);
    const filename = `RasterZone-OCR-Portable-${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(zipBuffer);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "ไม่สามารถส่งออกชุดโปรแกรมได้";
    console.error("Export bundle error:", err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/export-offline-html", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      includeCurrentZones?: boolean;
      zones?: unknown[];
      templates?: unknown[];
    };

    const html = await buildOfflineHtmlString(__dirname, {
      ...body,
      allowBuildFallback: true,
    });
    const filename = `RasterZone-OCR-Offline-${new Date().toISOString().slice(0, 10)}.html`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(html);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถสร้างเว็บแอปออฟไลน์ได้";
    console.error("Export offline HTML error:", err);
    res.status(500).json({ error: message });
  }
});

async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("/{*path}", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`RasterZone OCR server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

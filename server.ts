import express from "express";
import type { Request, Response } from "express";
import dotenv from "dotenv";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import JSZip from "jszip";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error(
      "ไม่พบ GEMINI_API_KEY บนเซิร์ฟเวอร์ กรุณาตั้งค่าคีย์ใน Settings > Secrets ก่อนใช้งาน OCR"
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const isRetryable =
        message.includes("429") ||
        message.includes("503") ||
        message.includes("RESOURCE_EXHAUSTED") ||
        message.includes("UNAVAILABLE");
      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

function stripDataUrlPrefix(base64OrDataUrl: string): { data: string; mimeType: string } {
  const match = base64OrDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  return { mimeType: "image/png", data: base64OrDataUrl };
}

interface ZoneInput {
  zoneId: string;
  label: string;
  dataType: string;
  imageBase64: string;
  mimeType?: string;
}

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

    const ai = getGeminiClient();
    const batchSize = 10;
    const aggregated: Record<string, { text: string; confidence: "high" | "medium" | "low" }> = {};

    for (let i = 0; i < zones.length; i += batchSize) {
      const chunk = zones.slice(i, i + batchSize);
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        {
          text: [
            "You are a high-precision document OCR engine specialized in Thai and English customs, shipping, tax invoices, and business forms.",
            "Below are cropped raster image regions from a scanned/rendered document.",
            "For EACH region, transcribe the exact text visible inside the image verbatim.",
            "Rules:",
            "- Preserve Thai characters, English letters, numbers, slashes, hyphens, and punctuation exactly as shown.",
            "- If the field type is 'date', preserve the date format cleanly.",
            "- If the field type is 'number', preserve numeric formatting accurately.",
            "- If the field type is 'table', preserve row breaks with newlines and columns separated by ' | '.",
            "- If the crop is blank or contains no readable text, return an empty string ''.",
            "- Do NOT translate, guess missing text, or add commentary.",
            body.languageHint ? `Document context hint: ${body.languageHint}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ];

      for (const z of chunk) {
        const parsed = stripDataUrlPrefix(z.imageBase64);
        parts.push({
          text: `\n--- REGION START ---\nzoneId: "${z.zoneId}"\nfieldLabel: "${z.label}"\ndataType: "${z.dataType}"`,
        });
        parts.push({
          inlineData: {
            mimeType: z.mimeType || parsed.mimeType,
            data: parsed.data,
          },
        });
      }

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: "gemini-4-hydrogen",
          contents: { parts },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      zoneId: { type: Type.STRING },
                      text: { type: Type.STRING },
                      confidence: { type: Type.STRING },
                    },
                    required: ["zoneId", "text", "confidence"],
                  },
                },
              },
              required: ["items"],
            },
          },
        })
      );

      const raw = (response.text ?? "{}").trim();
      const parsedJson = JSON.parse(raw) as {
        items?: Array<{ zoneId: string; text: string; confidence: string }>;
      };

      for (const item of parsedJson.items ?? []) {
        const conf =
          item.confidence === "low" || item.confidence === "medium" ? item.confidence : "high";
        aggregated[item.zoneId] = {
          text: (item.text ?? "").trim(),
          confidence: conf,
        };
      }
    }

    res.json({ results: aggregated });
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

    const mode = body.mode ?? "full-table";
    const parsed = stripDataUrlPrefix(body.imageBase64);
    const ai = getGeminiClient();

    if (mode === "full-lines") {
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: "gemini-4-hydrogen",
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: body.mimeType || parsed.mimeType,
                  data: parsed.data,
                },
              },
              {
                text: [
                  "Perform full-page layout-preserving OCR on this Thai/English document image.",
                  "Read EVERY readable line from top to bottom.",
                  "Within each horizontal visual row, split distinct columns/boxes separated by wide horizontal spacing or table borders into separate strings in the 'cells' array.",
                  "Preserve Thai and English text, numbers, barcodes, and dates verbatim.",
                  body.customHint ? `Additional instruction: ${body.customHint}` : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
              },
            ],
          },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                documentTitle: { type: Type.STRING },
                lines: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      lineNo: { type: Type.INTEGER },
                      cells: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                    },
                    required: ["lineNo", "cells"],
                  },
                },
              },
              required: ["documentTitle", "lines"],
            },
          },
        })
      );

      const data = JSON.parse((response.text ?? "{}").trim());
      res.json({
        documentTitle: data.documentTitle || "Document",
        keyValues: [],
        tables: [],
        lines: Array.isArray(data.lines) ? data.lines : [],
      });
      return;
    }

    const promptText =
      mode === "hybrid-table"
        ? [
            "Extract the tabular line items from this cropped table region image.",
            "Identify the column headers accurately (in Thai or English as printed) and extract EVERY row cleanly.",
            "Ensure every row in 'rows' has the exact same number of cells as 'headers'. Use '' for empty cells.",
            body.customHint ? `Additional instruction: ${body.customHint}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        : [
            "Analyze this full Thai/English document image and extract all structured data for Excel export.",
            "1. 'documentTitle': Main title or form name at the top of the document.",
            "2. 'keyValues': All labeled header/summary fields (e.g., Shipper, Invoice No, Date, Vessel, ETD, Port, Tax ID, Totals).",
            "3. 'tables': Every structured table on the page. For each table, provide 'tableName', 'headers' (column titles), and 'rows' (2D array where each row matches headers length).",
            "Preserve all Thai and English characters, numbers, and dates verbatim.",
            body.customHint ? `Additional instruction: ${body.customHint}` : "",
          ]
            .filter(Boolean)
            .join("\n");

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: body.mimeType || parsed.mimeType,
                data: parsed.data,
              },
            },
            { text: promptText },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              documentTitle: { type: Type.STRING },
              keyValues: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    key: { type: Type.STRING },
                    value: { type: Type.STRING },
                  },
                  required: ["key", "value"],
                },
              },
              tables: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    tableName: { type: Type.STRING },
                    headers: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    rows: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                    },
                  },
                  required: ["tableName", "headers", "rows"],
                },
              },
            },
            required: ["documentTitle", "keyValues", "tables"],
          },
        },
      })
    );

    const data = JSON.parse((response.text ?? "{}").trim());
    res.json({
      documentTitle: data.documentTitle || "Document",
      keyValues: Array.isArray(data.keyValues) ? data.keyValues : [],
      tables: Array.isArray(data.tables) ? data.tables : [],
      lines: [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาดระหว่างถอดข้อความทั้งหน้า";
    console.error("OCR full-page error:", err);
    res.status(500).json({ error: message });
  }
});

const EXCLUDED_DIRS = new Set(["node_modules", ".git", ".aistudio"]);
const EXCLUDED_FILES = new Set([".env", ".env.local", ".env.production", ".DS_Store"]);

async function addDirectoryToZip(
  zip: JSZip,
  diskDir: string,
  zipPrefix: string
): Promise<void> {
  const entries = await fs.readdir(diskDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      await addDirectoryToZip(
        zip,
        path.join(diskDir, entry.name),
        zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name
      );
    } else if (entry.isFile()) {
      if (EXCLUDED_FILES.has(entry.name) || entry.name.startsWith(".env.")) {
        // Keep .env.example, skip any real secret .env files
        if (entry.name !== ".env.example") continue;
      }
      const fileBytes = await fs.readFile(path.join(diskDir, entry.name));
      const zipPath = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;
      zip.file(zipPath, fileBytes);
    }
  }
}

app.post("/api/export-bundle", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      includeCurrentZones?: boolean;
      zones?: unknown[];
      templates?: unknown[];
    };

    const zip = new JSZip();
    const rootFolder = zip.folder("RasterZone-OCR-Portable");
    if (!rootFolder) {
      throw new Error("ไม่สามารถสร้างไฟล์ Zip ได้");
    }

    await addDirectoryToZip(rootFolder, __dirname, "");

    // Optionally embed user's active OCR coordinate zones & templates as default preset
    if (body?.includeCurrentZones && Array.isArray(body.zones)) {
      const presetPayload = JSON.stringify(
        {
          zones: body.zones,
          templates: Array.isArray(body.templates) ? body.templates : [],
          exportedAt: new Date().toISOString(),
        },
        null,
        2
      );
      rootFolder.file("public/default-preset.json", presetPayload);
      // Also copy into dist/ if dist exists so production build picks it up immediately
      try {
        await fs.access(path.join(__dirname, "dist"));
        rootFolder.file("dist/default-preset.json", presetPayload);
      } catch {
        // dist not built yet; Start script will build or run dev mode
      }
    }

    // 1-Click Windows Launcher (.bat)
    const windowsBat = [
      "@echo off",
      "title RasterZone OCR - Portable Launcher",
      "cd /d \"%~dp0\"",
      "",
      "where node >nul 2>nul",
      "if %errorlevel% neq 0 (",
      "  echo [ERROR] Node.js is not installed on this computer.",
      "  echo Please install Node.js LTS from https://nodejs.org and run again.",
      "  pause",
      "  exit /b 1",
      ")",
      "",
      "if not exist \".env\" (",
      "  if exist \".env.example\" (",
      "    copy \".env.example\" \".env\" >nul",
      "    echo Created .env file from .env.example.",
      "    echo Please open .env and set your GEMINI_API_KEY before scanning OCR.",
      "  )",
      ")",
      "",
      "if not exist \"node_modules\" (",
      "  echo First-time setup: Installing required packages...",
      "  call npm install",
      "  if %errorlevel% neq 0 (",
      "    echo [ERROR] npm install failed.",
      "    pause",
      "    exit /b 1",
      "  )",
      ")",
      "",
      "if not exist \"dist\\index.html\" (",
      "  echo Building frontend bundle...",
      "  call npm run build",
      ")",
      "",
      "echo Starting RasterZone OCR on http://localhost:3000 ...",
      "start \"\" cmd /c \"timeout /t 2 /nobreak >nul && start http://localhost:3000\"",
      "set NODE_ENV=production",
      "call npx tsx server.ts",
      "pause",
      "",
    ].join("\r\n");
    rootFolder.file("Start_Windows.bat", windowsBat);

    // 1-Click Mac/Linux Launcher (.command)
    const macCommand = [
      "#!/usr/bin/env bash",
      "cd \"$(dirname \"$0\")\"",
      "",
      "if ! command -v node >/dev/null 2>&1; then",
      "  echo \"[ERROR] Node.js is not installed. Please install from https://nodejs.org\"",
      "  read -p \"Press Enter to exit...\"",
      "  exit 1",
      "fi",
      "",
      "if [ ! -f \".env\" ] && [ -f \".env.example\" ]; then",
      "  cp .env.example .env",
      "  echo \"Created .env from .env.example — please set GEMINI_API_KEY inside .env\"",
      "fi",
      "",
      "if [ ! -d \"node_modules\" ]; then",
      "  echo \"First-time setup: Installing dependencies...\"",
      "  npm install",
      "fi",
      "",
      "if [ ! -f \"dist/index.html\" ]; then",
      "  npm run build",
      "fi",
      "",
      "echo \"Starting RasterZone OCR at http://localhost:3000 ...\"",
      "(sleep 2 && (open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || true)) &",
      "NODE_ENV=production npx tsx server.ts",
      "",
    ].join("\n");
    rootFolder.file("Start_Mac_Linux.command", macCommand, { unixPermissions: "755" });

    // Thai README for friends
    const readmeTh = [
      "============================================================",
      "  RasterZone OCR — คู่มือการติดตั้งและใช้งานสำหรับเครื่องเพื่อน",
      "============================================================",
      "",
      "ความต้องการของระบบ (ทำครั้งเดียว):",
      "1. ติดตั้ง Node.js (แนะนำเวอร์ชัน LTS ขึ้นไป) จาก https://nodejs.org",
      "",
      "ขั้นตอนการเปิดใช้งาน:",
      "1. แตกไฟล์ .zip นี้ไปยังโฟลเดอร์ที่ต้องการ",
      "2. เปิดไฟล์ .env (หากยังไม่มี ให้ก๊อปปี้ .env.example แล้วเปลี่ยนชื่อเป็น .env)",
      "   จากนั้นใส่ Gemini API Key ของคุณในบรรทัด:",
      "   GEMINI_API_KEY=\"ใส่คีย์ของคุณที่นี่\"",
      "   (ขอคีย์ฟรีได้จาก Google AI Studio: https://aistudio.google.com/apikey)",
      "3. เปิดโปรแกรม:",
      "   - สำหรับ Windows: ดับเบิลคลิกไฟล์ Start_Windows.bat",
      "   - สำหรับ Mac / Linux: ดับเบิลคลิกไฟล์ Start_Mac_Linux.command",
      "     (หาก Mac แจ้งสิทธิ์ ให้เปิด Terminal แล้วรัน chmod +x Start_Mac_Linux.command)",
      "4. รอติดตั้งแพ็กเกจอัตโนมัติในครั้งแรก จากนั้นเบราว์เซอร์จะเปิดหน้า",
      "   http://localhost:3000 ให้อัตโนมัติ",
      "",
      "หมายเหตุ:",
      "- ตัวโปรแกรมทำงานแบบแปลง PDF เป็นรูปภาพบนเครื่องผู้ใช้ทั้งหมด",
      "- หากผู้ส่งเลือก 'รวมเทมเพลตพิกัด OCR' มาด้วย กรอบพิกัดจะถูกโหลดให้ทันทีที่เปิดโปรแกรม",
      "",
    ].join("\r\n");
    rootFolder.file("README_วิธีใช้งานสำหรับเพื่อน.txt", readmeTh);

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

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

import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import JSZip from "jszip";

const execFileAsync = promisify(execFile);

const EXCLUDED_DIRS = new Set(["node_modules", ".git", ".aistudio", "dist-offline", ".vercel"]);
const EXCLUDED_FILES = new Set([".env", ".env.local", ".env.production", ".DS_Store"]);

export interface PresetExportOptions {
  includeCurrentZones?: boolean;
  zones?: unknown[];
  templates?: unknown[];
}

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
        if (entry.name !== ".env.example") continue;
      }
      const fileBytes = await fs.readFile(path.join(diskDir, entry.name));
      const zipPath = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;
      zip.file(zipPath, fileBytes);
    }
  }
}

export async function buildPortableZipBuffer(
  rootDir: string,
  options?: PresetExportOptions
): Promise<Buffer> {
  const zip = new JSZip();
  const rootFolder = zip.folder("RasterZone-OCR-Portable");
  if (!rootFolder) {
    throw new Error("ไม่สามารถสร้างไฟล์ Zip ได้");
  }

  await addDirectoryToZip(rootFolder, rootDir, "");

  if (options?.includeCurrentZones && Array.isArray(options.zones)) {
    const presetPayload = JSON.stringify(
      {
        zones: options.zones,
        templates: Array.isArray(options.templates) ? options.templates : [],
        exportedAt: new Date().toISOString(),
      },
      null,
      2
    );
    rootFolder.file("public/default-preset.json", presetPayload);
    try {
      await fs.access(path.join(rootDir, "dist"));
      rootFolder.file("dist/default-preset.json", presetPayload);
    } catch {
      // dist may not exist yet
    }
  }

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

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export async function buildOfflineHtmlString(
  rootDir: string,
  options?: PresetExportOptions & { allowBuildFallback?: boolean }
): Promise<string> {
  const offlineHtmlPath = path.join(rootDir, "dist-offline", "index.html");
  let exists = false;
  try {
    await fs.access(offlineHtmlPath);
    exists = true;
  } catch {
    exists = false;
  }

  if (!exists) {
    if (options?.allowBuildFallback) {
      await execFileAsync(
        "npx",
        ["vite", "build", "--config", "vite.offline.config.ts"],
        { cwd: rootDir }
      );
    } else {
      throw new Error(
        "ไม่พบไฟล์ dist-offline/index.html กรุณาตรวจสอบว่าขั้นตอน Build บนเซิร์ฟเวอร์รันคำสั่ง npm run build สำเร็จแล้ว"
      );
    }
  }

  let html = await fs.readFile(offlineHtmlPath, "utf-8");

  const presetData =
    options?.includeCurrentZones && Array.isArray(options.zones)
      ? {
          zones: options.zones,
          templates: Array.isArray(options.templates) ? options.templates : [],
          exportedAt: new Date().toISOString(),
        }
      : null;

  const safeJson = JSON.stringify(presetData).replace(/<\/script/gi, "<\\/script");
  const bootstrapScript = `<script>
window.__RASTERZONE_OFFLINE_STANDALONE__ = true;
window.__RASTERZONE_DEFAULT_PRESET__ = ${safeJson};
</script>`;

  return html.replace("</head>", `${bootstrapScript}\n</head>`);
}

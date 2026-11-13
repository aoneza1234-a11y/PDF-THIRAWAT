import React, { useState } from 'react';
import {
  Archive,
  Check,
  Copy,
  Download,
  FileCode2,
  FolderArchive,
  KeyRound,
  Loader2,
  Share2,
  Terminal,
} from 'lucide-react';
import type { OcrZone, ZoneTemplate } from '../types/ocr';

interface ExportAppPanelProps {
  zones: OcrZone[];
  templates: ZoneTemplate[];
}

export const ExportAppPanel: React.FC<ExportAppPanelProps> = ({
  zones,
  templates,
}) => {
  const [includeCurrentZones, setIncludeCurrentZones] = useState(true);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDone, setExportDone] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const handleDownloadPortableZip = async () => {
    setDownloadingZip(true);
    setExportError(null);
    setExportDone(false);

    try {
      const resp = await fetch('/api/export-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          includeCurrentZones,
          zones: includeCurrentZones ? zones : [],
          templates: includeCurrentZones ? templates : [],
        }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'ไม่สามารถสร้างไฟล์แพ็กเกจโปรแกรมได้');
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RasterZone-OCR-Portable-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setExportDone(true);
    } catch (err: unknown) {
      setExportError(
        err instanceof Error ? err.message : 'เกิดข้อผิดพลาดระหว่างส่งออกไฟล์'
      );
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleExportTemplateOnly = () => {
    const payload = JSON.stringify(
      {
        zones,
        templates,
        exportedAt: new Date().toISOString(),
      },
      null,
      2
    );
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rasterzone-templates-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyShareUrl = async () => {
    await navigator.clipboard.writeText(window.location.origin);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 1800);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-6 lg:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            ส่งออกตัวโปรแกรม & แชร์ให้เพื่อนใช้งาน
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            ดาวน์โหลดตัวโปรแกรมเป็นไฟล์แพ็กเกจพร้อมรัน (`.zip`) สำหรับนำไปแตกไฟล์เปิดใช้งานบนเครื่องเพื่อน
            หรือส่งออกเฉพาะไฟล์เทมเพลตพิกัด OCR
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Primary Card: Portable Zip Bundle */}
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-blue-600 shrink-0">
                  <FolderArchive className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    ส่งออกแพ็กเกจโปรแกรมพร้อมใช้งาน (.zip)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    รวมซอร์สโค้ดทั้งหมด, หน้าเว็บที่ Build แล้ว, เซิร์ฟเวอร์ OCR และสคริปต์เปิดโปรแกรมแบบคลิกเดียวสำหรับ Windows และ Mac/Linux
                  </p>
                </div>
              </div>
            </div>

            {/* Package contents list */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs">
              <div className="flex items-start gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-md">
                <Terminal className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-slate-800">
                    Start_Windows.bat & Start_Mac_Linux.command
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    ดับเบิลคลิกเพื่อติดตั้งและเปิดเว็บที่ localhost:3000 อัตโนมัติ
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-md">
                <FileCode2 className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-slate-800">
                    Full Source + Production Build
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    พร้อมระบบแปลง PDF เป็นภาพ, กำหนดพิกัด mm และส่งออก Excel
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-md">
                <KeyRound className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-slate-800">
                    ปลอดภัยไม่ติด API Key ส่วนตัว
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    แนบไฟล์ .env.example ให้เพื่อนใส่ Gemini API Key ของตัวเอง
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-md">
                <Archive className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-slate-800">
                    README_วิธีใช้งานสำหรับเพื่อน.txt
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    คู่มือภาษาไทยแบบทีละขั้นตอนสำหรับเครื่องที่เปิดครั้งแรก
                  </div>
                </div>
              </div>
            </div>

            {/* Embed active zones option */}
            <label className="flex items-start gap-2.5 p-3.5 bg-blue-50/50 border border-blue-200 rounded-md cursor-pointer">
              <input
                type="checkbox"
                checked={includeCurrentZones}
                onChange={(e) => setIncludeCurrentZones(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <div className="text-xs">
                <div className="font-semibold text-slate-900">
                  ฝังกรอบพิกัด OCR และเทมเพลตปัจจุบันเข้าไปในตัวโปรแกรมด้วย (
                  <span className="font-mono-tabular">{zones.length}</span> กรอบ,{' '}
                  <span className="font-mono-tabular">{templates.length}</span> เทมเพลต)
                </div>
                <div className="text-slate-600 mt-0.5">
                  เมื่อเพื่อนแตกไฟล์และเปิดโปรแกรม กรอบพิกัดที่คุณตีไว้จะถูกโหลดเป็นค่าเริ่มต้นให้ใช้งานได้ทันที
                </div>
              </div>
            </label>

            {exportError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-700">
                {exportError}
              </div>
            )}

            {exportDone && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-800 flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  ดาวน์โหลดไฟล์ RasterZone-OCR-Portable.zip เรียบร้อยแล้ว สามารถส่งไฟล์นี้ให้เพื่อนได้เลย
                </span>
              </div>
            )}

            <div className="pt-1 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={downloadingZip}
                onClick={handleDownloadPortableZip}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                {downloadingZip ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>กำลังแพ็กเกจไฟล์ .zip...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>ดาวน์โหลดตัวโปรแกรม (.zip)</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleExportTemplateOnly}
                className="flex items-center gap-2 px-4 py-2.5 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <FileCode2 className="w-4 h-4" />
                <span>ส่งออกเฉพาะพิกัด OCR (.json)</span>
              </button>
            </div>
          </div>

          {/* Right Side: Quick Steps for Friend + Share Web Link */}
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                ขั้นตอนเมื่อเพื่อนได้รับไฟล์ .zip
              </h3>
              <ol className="space-y-2.5 text-xs text-slate-600 list-decimal list-inside leading-relaxed">
                <li>
                  ติดตั้ง <strong className="text-slate-800">Node.js (LTS)</strong> บนเครื่อง (ทำเพียงครั้งแรก)
                </li>
                <li>แตกไฟล์ <code className="font-mono-tabular text-slate-800">.zip</code> ลงในโฟลเดอร์</li>
                <li>
                  คัดลอกไฟล์ <code className="font-mono-tabular text-slate-800">.env.example</code> เป็น{' '}
                  <code className="font-mono-tabular text-slate-800">.env</code> แล้วใส่{' '}
                  <code className="font-mono-tabular text-slate-800">GEMINI_API_KEY</code>
                </li>
                <li>
                  ดับเบิลคลิก <strong className="text-slate-800">Start_Windows.bat</strong> (หรือ{' '}
                  <strong className="text-slate-800">Start_Mac_Linux.command</strong>) เพื่อเปิดใช้งานทันที
                </li>
              </ol>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Share2 className="w-4 h-4 text-blue-600" />
                <span>แชร์ลิงก์เว็บแอปออนไลน์</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                หากเปิดใช้งานผ่านหน้าเว็บออนไลน์โดยตรง สามารถคัดลอกลิงก์ URL ปัจจุบันส่งให้เพื่อนพร้อมไฟล์เทมเพลต{' '}
                <code className="font-mono-tabular">.json</code> ได้เช่นกัน
              </p>
              <button
                type="button"
                onClick={handleCopyShareUrl}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-medium rounded-md transition-colors"
              >
                {copiedUrl ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>คัดลอกลิงก์แล้ว</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>คัดลอกลิงก์หน้าเว็บ</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

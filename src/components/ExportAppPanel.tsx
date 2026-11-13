import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FileCode2,
  FolderArchive,
  Globe,
  HardDriveDownload,
  Loader2,
  Share2,
  WifiOff,
} from 'lucide-react';
import type { OcrZone, ZoneTemplate } from '../types/ocr';
import { postForBlob } from '../utils/apiClient';
import { preloadOfflineLanguagePack } from '../utils/offlineOcr';
import { PWAInstallButton } from './PWAInstallButton';

interface ExportAppPanelProps {
  zones: OcrZone[];
  templates: ZoneTemplate[];
}

export const ExportAppPanel: React.FC<ExportAppPanelProps> = ({
  zones,
  templates,
}) => {
  const [includeCurrentZones, setIncludeCurrentZones] = useState(true);
  const [downloadingHtml, setDownloadingHtml] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [cachingLang, setCachingLang] = useState(false);
  const [langCacheDone, setLangCacheDone] = useState(false);
  const [langProgress, setLangProgress] = useState<string>('');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDoneMsg, setExportDoneMsg] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const isStandaloneOffline =
    typeof window !== 'undefined' &&
    (window.location.protocol === 'file:' ||
      Boolean(
        (window as unknown as { __RASTERZONE_OFFLINE_STANDALONE__?: boolean })
          .__RASTERZONE_OFFLINE_STANDALONE__
      ));

  const handleDownloadOfflineHtml = async () => {
    setDownloadingHtml(true);
    setExportError(null);
    setExportDoneMsg(null);

    try {
      const blob = await postForBlob(
        '/api/export-offline-html',
        {
          includeCurrentZones,
          zones: includeCurrentZones ? zones : [],
          templates: includeCurrentZones ? templates : [],
        },
        'ไม่สามารถสร้างไฟล์เว็บแอปออฟไลน์ได้'
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RasterZone-OCR-Offline-${new Date().toISOString().slice(0, 10)}.html`;
      a.click();
      URL.revokeObjectURL(url);
      setExportDoneMsg(
        'ดาวน์โหลดไฟล์ RasterZone-OCR-Offline.html สำเร็จ! เพื่อนสามารถดับเบิลคลิกเปิดใน Chrome/Edge ได้ทันทีโดยไม่ต้องติดตั้ง Node.js'
      );
    } catch (err: unknown) {
      setExportError(
        err instanceof Error ? err.message : 'เกิดข้อผิดพลาดระหว่างส่งออกไฟล์'
      );
    } finally {
      setDownloadingHtml(false);
    }
  };

  const handleDownloadPortableZip = async () => {
    setDownloadingZip(true);
    setExportError(null);
    setExportDoneMsg(null);

    try {
      const blob = await postForBlob(
        '/api/export-bundle',
        {
          includeCurrentZones,
          zones: includeCurrentZones ? zones : [],
          templates: includeCurrentZones ? templates : [],
        },
        'ไม่สามารถสร้างไฟล์แพ็กเกจโปรแกรมได้'
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RasterZone-OCR-Portable-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setExportDoneMsg(
        'ดาวน์โหลดแพ็กเกจเซิร์ฟเวอร์พกพา (.zip) เรียบร้อยแล้ว'
      );
    } catch (err: unknown) {
      setExportError(
        err instanceof Error ? err.message : 'เกิดข้อผิดพลาดระหว่างส่งออกไฟล์'
      );
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleCacheOfflineOcr = async () => {
    setCachingLang(true);
    setLangCacheDone(false);
    setExportError(null);
    try {
      await preloadOfflineLanguagePack((status, progress) => {
        setLangProgress(`${status} (${Math.round(progress * 100)}%)`);
      });
      setLangCacheDone(true);
      setLangProgress('');
    } catch (err: unknown) {
      setExportError(
        err instanceof Error
          ? err.message
          : 'ไม่สามารถดาวน์โหลดชุดภาษา OCR ออฟไลน์ได้'
      );
    } finally {
      setCachingLang(false);
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
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              ส่งออกเป็นเว็บแอปออฟไลน์พร้อมใช้ & แชร์ให้เพื่อน
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              ส่งออกเป็นไฟล์ HTML เดี่ยวเปิดใช้งานได้ทันทีโดยไม่ต้องลงโปรแกรมเสริม หรือติดตั้งเป็นแอป PWA ออฟไลน์บนเครื่อง
            </p>
          </div>
          {!isStandaloneOffline && <PWAInstallButton />}
        </div>

        {/* Embed active zones option */}
        <label className="flex items-start gap-2.5 p-4 bg-white border border-blue-200 rounded-lg cursor-pointer">
          <input
            type="checkbox"
            checked={includeCurrentZones}
            onChange={(e) => setIncludeCurrentZones(e.target.checked)}
            className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <div className="text-xs">
            <div className="font-semibold text-slate-900">
              ฝังกรอบพิกัด OCR และเทมเพลตปัจจุบันเข้าไปในตัวโปรแกรมที่ส่งออกด้วย (
              <span className="font-mono-tabular">{zones.length}</span> กรอบ,{' '}
              <span className="font-mono-tabular">{templates.length}</span> เทมเพลต)
            </div>
            <div className="text-slate-600 mt-0.5">
              เมื่อเพื่อนเปิดไฟล์เว็บแอปออฟไลน์ กรอบพิกัดที่คุณตั้งค่าไว้จะถูกโหลดขึ้นมาเป็นค่าเริ่มต้นทันที
            </div>
          </div>
        </label>

        {exportError && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-700">
            {exportError}
          </div>
        )}

        {exportDoneMsg && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-800 flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{exportDoneMsg}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Option 1 (Primary): Standalone Single-File Offline HTML */}
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-blue-600 shrink-0">
                <WifiOff className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  ส่งออกเว็บแอปออฟไลน์ไฟล์เดียวพร้อมใช้ (.html)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  ได้ไฟล์ <code className="font-mono-tabular text-slate-700">RasterZone-OCR-Offline.html</code>{' '}
                  ไฟล์เดียว ส่งให้เพื่อนทาง Line/Email ได้เลย เพื่อนดับเบิลคลิกเปิดในเบราว์เซอร์ได้ทันที ไม่ต้องติดตั้ง Node.js ไม่ต้องตั้งค่า API Key
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                <div className="font-semibold text-slate-800">
                  แปลง PDF เป็นภาพในเครื่อง 100%
                </div>
                <div className="text-slate-500 mt-0.5">
                  รวมเอนจิน PDF-to-Image (150–300 DPI) และไม้บรรทัดพิกัด mm ไว้ในไฟล์เดียว
                </div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                <div className="font-semibold text-slate-800">
                  อ่าน OCR ภาษาไทย+อังกฤษในเบราว์เซอร์
                </div>
                <div className="text-slate-500 mt-0.5">
                  ใช้ Tesseract WASM อ่านภาพและส่งออก Excel (.xlsx) / CSV ได้โดยไม่ต้องมีเซิร์ฟเวอร์
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              {!isStandaloneOffline ? (
                <button
                  type="button"
                  disabled={downloadingHtml}
                  onClick={handleDownloadOfflineHtml}
                  className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  {downloadingHtml ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>กำลังรวมเว็บแอปออฟไลน์ไฟล์เดียว...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span>ดาวน์โหลดเว็บแอปออฟไลน์ (.html)</span>
                    </>
                  )}
                </button>
              ) : (
                <div className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-md">
                  คุณกำลังใช้งานเว็บแอปเวอร์ชันออฟไลน์ไฟล์เดียวอยู่แล้ว (สามารถส่งต่อไฟล์ .html นี้ให้เพื่อนได้เลย)
                </div>
              )}

              <button
                type="button"
                disabled={cachingLang}
                onClick={handleCacheOfflineOcr}
                className="flex items-center gap-2 px-4 py-2.5 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                {cachingLang ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="font-mono-tabular">
                      {langProgress || 'กำลังแคชภาษา OCR...'}
                    </span>
                  </>
                ) : langCacheDone ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>แคชภาษา OCR (ไทย+Eng) พร้อมออฟไลน์แล้ว</span>
                  </>
                ) : (
                  <>
                    <HardDriveDownload className="w-4 h-4" />
                    <span>เตรียมข้อมูลภาษา OCR ออฟไลน์ในเครื่อง</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Column: PWA + Node Portable Zip + Template JSON */}
          <div className="space-y-4">
            {/* Portable Node Zip (with Gemini AI) */}
            {!isStandaloneOffline && (
              <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <FolderArchive className="w-4 h-4 text-slate-700" />
                  <span>แพ็กเกจพร้อม Gemini AI (.zip)</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  สำหรับเครื่องที่มี Node.js และต้องการใช้ Gemini Vision OCR ความแม่นยำสูง (มี .bat / .command เปิดคลิกเดียว)
                </p>
                <button
                  type="button"
                  disabled={downloadingZip}
                  onClick={handleDownloadPortableZip}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-md transition-colors"
                >
                  {downloadingZip ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>ดาวน์โหลดแพ็กเกจ .zip</span>
                </button>
              </div>
            )}

            {/* Template JSON & Share Link */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Share2 className="w-4 h-4 text-blue-600" />
                <span>แชร์เทมเพลต / ลิงก์เว็บ</span>
              </div>
              <button
                type="button"
                onClick={handleExportTemplateOnly}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-md transition-colors"
              >
                <FileCode2 className="w-3.5 h-3.5" />
                <span>ส่งออกเฉพาะกรอบพิกัด (.json)</span>
              </button>

              {!isStandaloneOffline && (
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
                      <span>คัดลอกลิงก์เว็บแอป</span>
                    </>
                  )}
                </button>
              )}

              <div className="pt-1 flex items-start gap-2 text-[11px] text-slate-500">
                <Globe className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  ถ้าใช้งานบน Chrome / Edge สามารถกดเมนูเบราว์เซอร์ &ldquo;Install App&rdquo; เพื่อปักหมุดเป็นแอปออฟไลน์บน Desktop ได้ทันที
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

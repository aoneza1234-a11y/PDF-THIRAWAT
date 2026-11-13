import React, { useEffect, useState } from 'react';
import {
  BookmarkPlus,
  Download,
  FolderOpen,
  Layers,
  Loader2,
  Play,
  ScanText,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  ExtractionMode,
  OcrZone,
  RenderedPage,
  ZoneDataType,
  ZoneTemplate,
} from '../types/ocr';
import { compressImageForApi, cropZoneImage } from '../utils/rasterizer';
import { postJson } from '../utils/apiClient';
import { runOfflineZonesOcr } from '../utils/offlineOcr';

interface ZoneInspectorProps {
  mode: ExtractionMode;
  ocrEngine: 'cloud' | 'offline';
  page: RenderedPage | null;
  zones: OcrZone[];
  selectedZoneId: string | null;
  grayscale: boolean;
  contrastBoost: boolean;
  customHint: string;
  templates: ZoneTemplate[];
  onChangeCustomHint: (val: string) => void;
  onSelectZone: (id: string | null) => void;
  onUpdateZone: (id: string, patch: Partial<OcrZone>) => void;
  onDeleteZone: (id: string) => void;
  onClearZones: () => void;
  onSaveTemplate: (name: string) => void;
  onApplyTemplate: (template: ZoneTemplate) => void;
  onDeleteTemplate: (id: string) => void;
  onImportZonesJson: (zones: OcrZone[]) => void;
}

export const ZoneInspector: React.FC<ZoneInspectorProps> = ({
  mode,
  ocrEngine,
  page,
  zones,
  selectedZoneId,
  grayscale,
  contrastBoost,
  customHint,
  templates,
  onChangeCustomHint,
  onSelectZone,
  onUpdateZone,
  onDeleteZone,
  onClearZones,
  onSaveTemplate,
  onApplyTemplate,
  onDeleteTemplate,
  onImportZonesJson,
}) => {
  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;
  const [cropPreviewUrl, setCropPreviewUrl] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');

  useEffect(() => {
    setTestResult(null);
    setTestError(null);
    if (!page || !selectedZone) {
      setCropPreviewUrl(null);
      return;
    }

    let cancelled = false;
    cropZoneImage(page, selectedZone, { grayscale, contrastBoost })
      .then((url) => {
        if (!cancelled) setCropPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setCropPreviewUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [page, selectedZone, grayscale, contrastBoost]);

  const handleTestSingleZone = async () => {
    if (!page || !selectedZone) return;
    setTestLoading(true);
    setTestError(null);
    try {
      const croppedUrl = await cropZoneImage(page, selectedZone, {
        grayscale,
        contrastBoost,
      });

      if (ocrEngine === 'offline') {
        const data = await runOfflineZonesOcr([
          {
            zoneId: selectedZone.id,
            label: selectedZone.label,
            dataType: selectedZone.dataType,
            imageBase64: croppedUrl,
          },
        ]);
        const text = data.results?.[selectedZone.id]?.text ?? '';
        setTestResult(text || '(ไม่พบข้อความในกรอบนี้)');
      } else {
        const prepared = await compressImageForApi(croppedUrl);
        const data = await postJson<{
          results?: Record<string, { text: string; confidence: string }>;
        }>(
          '/api/ocr/zones',
          {
            zones: [
              {
                zoneId: selectedZone.id,
                label: selectedZone.label,
                dataType: selectedZone.dataType,
                imageBase64: prepared.dataUrl,
                mimeType: prepared.mimeType,
              },
            ],
          },
          'ไม่สามารถอ่าน OCR ได้'
        );
        const text = data.results?.[selectedZone.id]?.text ?? '';
        setTestResult(text || '(ไม่พบข้อความในกรอบนี้)');
      }
    } catch (err: unknown) {
      setTestError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setTestLoading(false);
    }
  };

  const handleExportTemplateJson = () => {
    const payload = JSON.stringify({ zones }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ocr_zones_template_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported = Array.isArray(parsed) ? parsed : parsed?.zones;
      if (Array.isArray(imported)) {
        onImportZonesJson(imported);
      }
    } catch {
      // Ignore malformed JSON silently
    } finally {
      e.target.value = '';
    }
  };

  const zonesAllowed = mode === 'zones' || mode === 'hybrid';

  const toMm = (ratio: number, totalMm: number) => Number((ratio * totalMm).toFixed(1));
  const updateFromMm = (
    field: 'xRatio' | 'yRatio' | 'wRatio' | 'hRatio',
    mmVal: number,
    totalMm: number
  ) => {
    if (!Number.isFinite(mmVal) || totalMm <= 0) return;
    const clamped = Math.min(1, Math.max(0, mmVal / totalMm));
    onUpdateZone(selectedZone!.id, { [field]: clamped });
  };

  return (
    <aside className="w-full lg:w-[320px] shrink-0 bg-white border-l border-slate-200 flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          {zonesAllowed ? 'ตั้งค่าพิกัด & กรอบ OCR' : 'ตั้งค่าการอ่านทั้งหน้า'}
        </h2>
        {zonesAllowed && (
          <span className="text-xs text-slate-500 font-mono-tabular">
            {zones.length} กรอบ
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
        {/* Selected Zone Inspector */}
        {zonesAllowed && selectedZone && page && (
          <div className="p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-600">
                กรอบที่เลือกอยู่
              </span>
              <button
                type="button"
                onClick={() => onDeleteZone(selectedZone.id)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>ลบกรอบ</span>
              </button>
            </div>

            {/* Live Crop Preview */}
            <div className="border border-slate-200 rounded-md bg-slate-50 p-2">
              <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1.5">
                <span>ภาพส่วนที่จะส่งถอด OCR (Crop Preview)</span>
                <span className="font-mono-tabular">
                  {Math.round(selectedZone.wRatio * page.widthPx)}×
                  {Math.round(selectedZone.hRatio * page.heightPx)} px
                </span>
              </div>
              {cropPreviewUrl ? (
                <div className="bg-white border border-slate-200 rounded p-1.5 flex items-center justify-center max-h-28 overflow-hidden">
                  <img
                    src={cropPreviewUrl}
                    alt={selectedZone.label}
                    className="max-h-24 w-auto object-contain"
                  />
                </div>
              ) : (
                <div className="h-16 flex items-center justify-center text-xs text-slate-400">
                  กำลังสร้างภาพตัวอย่าง...
                </div>
              )}
            </div>

            {/* Label / Excel Column Name */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                ชื่อฟิลด์ / หัวคอลัมน์ Excel
              </label>
              <input
                type="text"
                value={selectedZone.label}
                onChange={(e) =>
                  onUpdateZone(selectedZone.id, { label: e.target.value })
                }
                placeholder="เช่น Shipper, INV_No, ETD"
                className="w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Data Type & Page Scope */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ประเภทข้อมูล
                </label>
                <select
                  value={selectedZone.dataType}
                  onChange={(e) =>
                    onUpdateZone(selectedZone.id, {
                      dataType: e.target.value as ZoneDataType,
                    })
                  }
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="text">ข้อความ (Text)</option>
                  <option value="number">ตัวเลข / เงิน</option>
                  <option value="date">วันที่ (Date)</option>
                  <option value="table">ตารางรายการ (Table)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ขอบเขตหน้า
                </label>
                <select
                  value={String(selectedZone.pageScope)}
                  onChange={(e) =>
                    onUpdateZone(selectedZone.id, {
                      pageScope:
                        e.target.value === 'all' ? 'all' : Number(e.target.value),
                    })
                  }
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">ใช้กับทุกหน้า</option>
                  <option value={String(page.pageNumber)}>
                    เฉพาะหน้า {page.pageNumber}
                  </option>
                </select>
              </div>
            </div>

            {/* Exact Millimeter Coordinates */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-700">
                  พิกัดบนกระดาษ (mm)
                </span>
                <span className="text-[11px] text-slate-400 font-mono-tabular">
                  {page.widthMm}×{page.heightMm} mm
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[11px] text-slate-500">X (ซ้าย)</span>
                  <input
                    type="number"
                    step="0.5"
                    value={toMm(selectedZone.xRatio, page.widthMm)}
                    onChange={(e) =>
                      updateFromMm('xRatio', Number(e.target.value), page.widthMm)
                    }
                    className="w-full px-2 py-1 text-xs font-mono-tabular border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <span className="text-[11px] text-slate-500">Y (บน)</span>
                  <input
                    type="number"
                    step="0.5"
                    value={toMm(selectedZone.yRatio, page.heightMm)}
                    onChange={(e) =>
                      updateFromMm('yRatio', Number(e.target.value), page.heightMm)
                    }
                    className="w-full px-2 py-1 text-xs font-mono-tabular border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <span className="text-[11px] text-slate-500">กว้าง (W)</span>
                  <input
                    type="number"
                    step="0.5"
                    value={toMm(selectedZone.wRatio, page.widthMm)}
                    onChange={(e) =>
                      updateFromMm('wRatio', Number(e.target.value), page.widthMm)
                    }
                    className="w-full px-2 py-1 text-xs font-mono-tabular border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <span className="text-[11px] text-slate-500">สูง (H)</span>
                  <input
                    type="number"
                    step="0.5"
                    value={toMm(selectedZone.hRatio, page.heightMm)}
                    onChange={(e) =>
                      updateFromMm('hRatio', Number(e.target.value), page.heightMm)
                    }
                    className="w-full px-2 py-1 text-xs font-mono-tabular border border-slate-300 rounded"
                  />
                </div>
              </div>
            </div>

            {/* Single Zone Quick OCR Test */}
            <div>
              <button
                type="button"
                disabled={testLoading}
                onClick={handleTestSingleZone}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-md transition-colors"
              >
                {testLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                <span>ทดสอบอ่าน OCR เฉพาะกรอบนี้</span>
              </button>

              {testResult !== null && (
                <div className="mt-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-md">
                  <div className="text-[11px] font-medium text-emerald-800 mb-0.5">
                    ผลลัพธ์ที่อ่านได้:
                  </div>
                  <div className="text-xs text-slate-900 whitespace-pre-wrap break-words font-mono-tabular">
                    {testResult}
                  </div>
                </div>
              )}

              {testError && (
                <div className="mt-2 p-2.5 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-700">
                  {testError}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Full-Page / Custom Hint Configuration */}
        <div className="p-4 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
            <ScanText className="w-4 h-4 text-blue-600" />
            <span>คำแนะนำเสริมสำหรับ OCR (ไม่บังคับ)</span>
          </div>
          <textarea
            rows={2}
            value={customHint}
            onChange={(e) => onChangeCustomHint(e.target.value)}
            placeholder="เช่น เอกสารใบขนสินค้าขาออก เน้นอ่านรหัส HS Code และวันที่รูปแบบ DD/MM/YYYY"
            className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {/* All Zones List */}
        {zonesAllowed && (
          <div className="p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800">
                รายการกรอบพิกัดทั้งหมด ({zones.length})
              </span>
              {zones.length > 0 && (
                <button
                  type="button"
                  onClick={onClearZones}
                  className="text-[11px] text-rose-600 hover:underline"
                >
                  ล้างทั้งหมด
                </button>
              )}
            </div>

            {zones.length === 0 ? (
              <p className="text-xs text-slate-500 leading-relaxed">
                ยังไม่มีกรอบพิกัด คลิกและลากบนหน้าเอกสารด้านซ้ายเพื่อสร้างกรอบที่ต้องการให้อ่าน OCR
              </p>
            ) : (
              <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                {zones.map((z, idx) => {
                  const active = z.id === selectedZoneId;
                  return (
                    <button
                      key={z.id}
                      type="button"
                      onClick={() => onSelectZone(z.id)}
                      className={`w-full text-left px-2.5 py-2 rounded-md border text-xs transition-colors flex items-center justify-between gap-2 ${
                        active
                          ? 'bg-rose-50 border-rose-300 text-rose-900'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {idx + 1}. {z.label}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono-tabular">
                          {z.dataType}
                          {page && (
                            <>
                              {' '}
                              · ({Math.round(z.xRatio * page.widthMm)},{' '}
                              {Math.round(z.yRatio * page.heightMm)} mm)
                            </>
                          )}
                        </div>
                      </div>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteZone(z.id);
                        }}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded"
                        title="ลบกรอบ"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Template Save / Load / JSON Import-Export */}
        {zonesAllowed && (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <Layers className="w-4 h-4 text-slate-600" />
                <span>เทมเพลตพิกัด (Templates)</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportTemplateJson}
                  disabled={zones.length === 0}
                  className="text-[11px] text-slate-600 hover:text-slate-900 disabled:opacity-40 flex items-center gap-1"
                  title="ส่งออกเทมเพลตเป็น JSON"
                >
                  <Download className="w-3 h-3" />
                  <span>JSON</span>
                </button>
                <label
                  className="text-[11px] text-blue-600 hover:text-blue-700 cursor-pointer flex items-center gap-1"
                  title="นำเข้าเทมเพลตจากไฟล์ JSON"
                >
                  <Upload className="w-3 h-3" />
                  <span>นำเข้า</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleImportJsonFile}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <div className="flex gap-1.5">
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="ตั้งชื่อเทมเพลต..."
                className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-slate-300 rounded-md"
              />
              <button
                type="button"
                disabled={zones.length === 0 || !templateName.trim()}
                onClick={() => {
                  onSaveTemplate(templateName.trim());
                  setTemplateName('');
                }}
                className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-md text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                <span>บันทึก</span>
              </button>
            </div>

            {templates.length > 0 && (
              <div className="space-y-1.5">
                {templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => onApplyTemplate(tpl)}
                      className="flex items-center gap-1.5 text-left min-w-0 flex-1 hover:text-blue-600"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate font-medium">{tpl.name}</span>
                      <span className="text-[11px] text-slate-400 font-mono-tabular shrink-0">
                        ({tpl.zones.length})
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteTemplate(tpl.id)}
                      className="text-slate-400 hover:text-rose-600 p-0.5"
                      title="ลบเทมเพลต"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};

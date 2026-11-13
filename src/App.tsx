import { useEffect, useState } from 'react';
import {
  AlertCircle,
  FileSpreadsheet,
  Loader2,
  Play,
  SlidersHorizontal,
} from 'lucide-react';
import { DocumentCanvas } from './components/DocumentCanvas';
import { ExportAppPanel } from './components/ExportAppPanel';
import { FileQueueSidebar } from './components/FileQueueSidebar';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ResultsPanel } from './components/ResultsPanel';
import { ZoneInspector } from './components/ZoneInspector';
import type {
  DocumentItem,
  ExtractionMode,
  FullPageResult,
  ImagePreprocessOptions,
  OcrZone,
  ZoneOcrCell,
  ZonePageResult,
  ZoneTemplate,
} from './types/ocr';
import { exportResultsToExcel } from './utils/excelExport';
import {
  compressImageForApi,
  cropZoneImage,
  generateSampleCustomsDocument,
  preprocessFullPageImage,
  rasterizeFile,
  rotatePageClockwise,
} from './utils/rasterizer';
import { postJson } from './utils/apiClient';
import { runOfflineFullPageOcr, runOfflineZonesOcr } from './utils/offlineOcr';

const TEMPLATES_STORAGE_KEY = 'rasterzone_ocr_templates_v1';

interface StandaloneWindow extends Window {
  __RASTERZONE_OFFLINE_STANDALONE__?: boolean;
  __RASTERZONE_DEFAULT_PRESET__?: {
    zones?: OcrZone[];
    templates?: ZoneTemplate[];
  } | null;
}

export default function App() {
  const isStandaloneOffline =
    typeof window !== 'undefined' &&
    (window.location.protocol === 'file:' ||
      Boolean((window as StandaloneWindow).__RASTERZONE_OFFLINE_STANDALONE__));

  const [activeTab, setActiveTab] = useState<'workspace' | 'results' | 'export'>('workspace');
  const [mode, setMode] = useState<ExtractionMode>('zones');
  const [ocrEngine, setOcrEngine] = useState<'cloud' | 'offline'>(() =>
    isStandaloneOffline || (typeof navigator !== 'undefined' && !navigator.onLine)
      ? 'offline'
      : 'cloud'
  );
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [activePageNumber, setActivePageNumber] = useState<number>(1);

  const [zones, setZones] = useState<OcrZone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ZoneTemplate[]>([]);

  const [preprocess, setPreprocess] = useState<ImagePreprocessOptions>({
    dpi: 200,
    grayscale: false,
    contrastBoost: false,
  });

  const [scanScope, setScanScope] = useState<'current' | 'all'>('all');
  const [customHint, setCustomHint] = useState<string>('');
  const [rasterizing, setRasterizing] = useState(false);

  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [ocrError, setOcrError] = useState<string | null>(null);

  const [zoneResults, setZoneResults] = useState<ZonePageResult[]>([]);
  const [fullPageResults, setFullPageResults] = useState<FullPageResult[]>([]);

  // Initialize templates and load clean sample customs document (or embedded preset) on first mount
  useEffect(() => {
    const sample = generateSampleCustomsDocument();
    setDocuments([sample.doc]);
    setActiveDocId(sample.doc.id);
    setActivePageNumber(1);
    setZones(sample.presetZones);
    setSelectedZoneId(sample.presetZones[4]?.id ?? null); // Select 'INV Date' initially

    let hasSavedTemplates = false;
    try {
      const saved = localStorage.getItem(TEMPLATES_STORAGE_KEY);
      if (saved) {
        setTemplates(JSON.parse(saved));
        hasSavedTemplates = true;
      } else {
        const defaultTpl: ZoneTemplate = {
          id: 'tpl_customs_export',
          name: 'ใบขนสินค้าขาออก (Customs Preset)',
          description: 'พิกัดมาตรฐานใบขนสินค้าขาออก กศก.101/1',
          zones: sample.presetZones,
          createdAt: new Date().toISOString(),
        };
        setTemplates([defaultTpl]);
        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify([defaultTpl]));
      }
    } catch {
      // Ignore localStorage restrictions
    }

    // 1. Check inline embedded preset injected into standalone offline .html
    const inlinePreset =
      typeof window !== 'undefined'
        ? (window as StandaloneWindow).__RASTERZONE_DEFAULT_PRESET__
        : null;
    if (inlinePreset && Array.isArray(inlinePreset.zones) && inlinePreset.zones.length > 0) {
      setZones(inlinePreset.zones);
      setSelectedZoneId(inlinePreset.zones[0]?.id ?? null);
      if (!hasSavedTemplates && Array.isArray(inlinePreset.templates) && inlinePreset.templates.length > 0) {
        setTemplates(inlinePreset.templates);
      }
      return;
    }

    // 2. Load friend-shared preset if bundled in /default-preset.json (HTTP server mode)
    if (window.location.protocol !== 'file:') {
      fetch('/default-preset.json')
        .then((res) => (res.ok ? res.json() : null))
        .then((preset) => {
          if (!preset) return;
          if (Array.isArray(preset.zones) && preset.zones.length > 0) {
            setZones(preset.zones);
            setSelectedZoneId(preset.zones[0]?.id ?? null);
          }
          if (!hasSavedTemplates && Array.isArray(preset.templates) && preset.templates.length > 0) {
            setTemplates(preset.templates);
          }
        })
        .catch(() => {
          // Optional file; ignore when absent
        });
    }
  }, []);

  const persistTemplates = (next: ZoneTemplate[]) => {
    setTemplates(next);
    try {
      localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore
    }
  };

  const activeDoc = documents.find((d) => d.id === activeDocId) ?? null;
  const activePage =
    activeDoc?.pages.find((p) => p.pageNumber === activePageNumber) ?? null;

  const totalPagesCount = documents.reduce((sum, d) => sum + d.pages.length, 0);

  const handleFilesAdded = async (
    items: Array<{ file: File; relativePath: string }>
  ) => {
    if (items.length === 0) return;
    setRasterizing(true);
    setOcrError(null);
    const failedFiles: string[] = [];
    try {
      const nextDocs: DocumentItem[] = [];
      for (const item of items) {
        try {
          const doc = await rasterizeFile(
            item.file,
            item.relativePath,
            preprocess.dpi
          );
          nextDocs.push(doc);
        } catch (fileErr: unknown) {
          const msg = fileErr instanceof Error ? fileErr.message : 'อ่านไฟล์ไม่ได้';
          failedFiles.push(`${item.file.name} (${msg})`);
        }
      }

      if (nextDocs.length > 0) {
        setDocuments((prev) => {
          const hasOnlySample =
            prev.length === 1 && prev[0].id.startsWith('sample_');
          return hasOnlySample ? nextDocs : [...prev, ...nextDocs];
        });
        setActiveDocId(nextDocs[0].id);
        setActivePageNumber(1);
      }

      if (failedFiles.length > 0) {
        setOcrError(`มีบางไฟล์ไม่สามารถแปลงภาพได้: ${failedFiles.join(', ')}`);
      }
    } finally {
      setRasterizing(false);
    }
  };

  const handleRotateActivePage = async () => {
    if (!activeDoc || !activePage) return;
    const rotated = await rotatePageClockwise(activePage);
    setDocuments((prev) =>
      prev.map((d) =>
        d.id === activeDoc.id
          ? {
              ...d,
              pages: d.pages.map((p) =>
                p.pageNumber === activePage.pageNumber ? rotated : p
              ),
            }
          : d
      )
    );
  };

  const handleLoadSample = () => {
    const sample = generateSampleCustomsDocument();
    setDocuments((prev) => [sample.doc, ...prev.filter((d) => !d.id.startsWith('sample_'))]);
    setActiveDocId(sample.doc.id);
    setActivePageNumber(1);
    setZones(sample.presetZones);
    setSelectedZoneId(sample.presetZones[4]?.id ?? null);
    setOcrError(null);
  };

  const handleRemoveDoc = (docId: string) => {
    setDocuments((prev) => {
      const remaining = prev.filter((d) => d.id !== docId);
      if (activeDocId === docId) {
        setActiveDocId(remaining[0]?.id ?? null);
        setActivePageNumber(1);
      }
      return remaining;
    });
  };

  const handleSelectPage = (docId: string, pageNumber: number) => {
    setActiveDocId(docId);
    setActivePageNumber(pageNumber);
  };

  const handleRunOcr = async () => {
    setOcrError(null);
    if (documents.length === 0) {
      setOcrError('กรุณาเพิ่มไฟล์ PDF หรือรูปภาพก่อนเริ่มอ่าน OCR');
      return;
    }

    if ((mode === 'zones' || mode === 'hybrid') && zones.length === 0) {
      setOcrError('กรุณาวาดกรอบพิกัดบนหน้าเอกสารอย่างน้อย 1 กรอบ หรือสลับเป็นโหมดอ่านทั้งหน้า');
      return;
    }

    const targets =
      scanScope === 'current' && activeDoc && activePage
        ? [{ doc: activeDoc, page: activePage }]
        : documents.flatMap((doc) => doc.pages.map((page) => ({ doc, page })));

    if (targets.length === 0) {
      setOcrError('ไม่พบหน้าเอกสารสำหรับประมวลผล');
      return;
    }

    setOcrRunning(true);
    setOcrProgress({ done: 0, total: targets.length });

    try {
      const nextZoneResults: ZonePageResult[] = [];
      const nextFullResults: FullPageResult[] = [];

      for (let i = 0; i < targets.length; i++) {
        const { doc, page } = targets[i];

        if (mode === 'zones' || mode === 'hybrid') {
          const applicableZones = zones.filter((z) => {
            if (mode === 'hybrid' && z.dataType === 'table') return false;
            return z.pageScope === 'all' || z.pageScope === page.pageNumber;
          });

          const cellsMap: Record<string, ZoneOcrCell> = {};

          if (applicableZones.length > 0) {
            const rawZonePayloads = await Promise.all(
              applicableZones.map(async (z) => {
                const cropped = await cropZoneImage(page, z, preprocess);
                return {
                  zoneId: z.id,
                  label: z.label,
                  dataType: z.dataType,
                  imageBase64: cropped,
                  mimeType: 'image/png',
                };
              })
            );

            let data: {
              results?: Record<
                string,
                { text: string; confidence: 'high' | 'medium' | 'low' }
              >;
              error?: string;
            };

            if (ocrEngine === 'offline') {
              data = await runOfflineZonesOcr(rawZonePayloads);
            } else {
              const zonePayloads = await Promise.all(
                rawZonePayloads.map(async (item) => {
                  const compressed = await compressImageForApi(item.imageBase64, 900_000);
                  return {
                    ...item,
                    imageBase64: compressed.dataUrl,
                    mimeType: compressed.mimeType,
                  };
                })
              );

              const mergedResults: Record<
                string,
                { text: string; confidence: 'high' | 'medium' | 'low' }
              > = {};
              const MAX_BATCH_CHARS = 2_400_000;
              let batch: typeof zonePayloads = [];
              let batchChars = 0;

              const flushBatch = async () => {
                if (batch.length === 0) return;
                const respData = await postJson<{
                  results?: Record<
                    string,
                    { text: string; confidence: 'high' | 'medium' | 'low' }
                  >;
                }>(
                  '/api/ocr/zones',
                  { zones: batch, languageHint: customHint },
                  'เกิดข้อผิดพลาดในการอ่าน OCR แบบกรอบพิกัด'
                );
                Object.assign(mergedResults, respData.results ?? {});
                batch = [];
                batchChars = 0;
              };

              for (const zp of zonePayloads) {
                const itemSize = zp.imageBase64.length + 256;
                if (batch.length > 0 && batchChars + itemSize > MAX_BATCH_CHARS) {
                  await flushBatch();
                }
                batch.push(zp);
                batchChars += itemSize;
              }
              await flushBatch();
              data = { results: mergedResults };
            }

            for (const payload of rawZonePayloads) {
              const r = data.results?.[payload.zoneId];
              cellsMap[payload.zoneId] = {
                zoneId: payload.zoneId,
                label: payload.label,
                value: r?.text ?? '',
                confidence: r?.confidence ?? 'high',
                cropPreviewUrl: payload.imageBase64,
              };
            }
          }

          nextZoneResults.push({
            id: `zr_${doc.id}_${page.pageNumber}`,
            docId: doc.id,
            docName: doc.name,
            relativePath: doc.relativePath,
            pageNumber: page.pageNumber,
            cells: cellsMap,
          });
        }

        if (mode === 'full-table' || mode === 'full-lines' || mode === 'hybrid') {
          let imageToScan = '';
          const apiMode: 'full-table' | 'full-lines' | 'hybrid-table' =
            mode === 'full-lines'
              ? 'full-lines'
              : mode === 'hybrid'
              ? 'hybrid-table'
              : 'full-table';

          if (mode === 'hybrid') {
            const tableZone = zones.find(
              (z) =>
                z.dataType === 'table' &&
                (z.pageScope === 'all' || z.pageScope === page.pageNumber)
            );
            imageToScan = tableZone
              ? await cropZoneImage(page, tableZone, preprocess)
              : await preprocessFullPageImage(page, preprocess);
          } else {
            imageToScan = await preprocessFullPageImage(page, preprocess);
          }

          let data: {
            documentTitle?: string;
            keyValues?: Array<{ key: string; value: string }>;
            tables?: Array<{ tableName: string; headers: string[]; rows: string[][] }>;
            lines?: Array<{ lineNo: number; cells: string[] }>;
            error?: string;
          };

          if (ocrEngine === 'offline') {
            data = await runOfflineFullPageOcr(imageToScan, apiMode);
          } else {
            const prepared = await compressImageForApi(imageToScan);
            data = await postJson(
              '/api/ocr/full-page',
              {
                imageBase64: prepared.dataUrl,
                mimeType: prepared.mimeType,
                mode: apiMode,
                customHint,
              },
              'เกิดข้อผิดพลาดในการถอดภาพทั้งหน้า'
            );
          }

          nextFullResults.push({
            id: `fp_${doc.id}_${page.pageNumber}`,
            docId: doc.id,
            docName: doc.name,
            relativePath: doc.relativePath,
            pageNumber: page.pageNumber,
            mode: mode === 'hybrid' ? 'hybrid' : mode,
            documentTitle: data.documentTitle || doc.name,
            keyValues: data.keyValues || [],
            tables: data.tables || [],
            lines: data.lines || [],
          });
        }

        setOcrProgress({ done: i + 1, total: targets.length });
      }

      if (mode === 'zones' || mode === 'hybrid') {
        setZoneResults(nextZoneResults);
      }
      if (mode !== 'zones') {
        setFullPageResults(nextFullResults);
      }
      setActiveTab('results');
    } catch (err: unknown) {
      setOcrError(err instanceof Error ? err.message : 'การอ่าน OCR ล้มเหลว');
    } finally {
      setOcrRunning(false);
      setOcrProgress(null);
    }
  };

  const handleSaveTemplate = (name: string) => {
    const newTpl: ZoneTemplate = {
      id: `tpl_${Date.now()}`,
      name,
      description: `${zones.length} พิกัดกรอบ OCR`,
      zones: JSON.parse(JSON.stringify(zones)),
      createdAt: new Date().toISOString(),
    };
    persistTemplates([newTpl, ...templates]);
  };

  const handleApplyTemplate = (tpl: ZoneTemplate) => {
    setZones(JSON.parse(JSON.stringify(tpl.zones)));
    setSelectedZoneId(tpl.zones[0]?.id ?? null);
  };

  const handleDeleteTemplate = (id: string) => {
    persistTemplates(templates.filter((t) => t.id !== id));
  };

  const hasExportableResults =
    mode === 'zones'
      ? zoneResults.length > 0
      : mode === 'hybrid'
      ? zoneResults.length > 0 || fullPageResults.length > 0
      : fullPageResults.length > 0;

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-50 text-slate-900 overflow-hidden">
      {/* Top Navigation Bar (Strict 3-Zone Contract) */}
      <header className="h-14 px-6 bg-white border-b border-slate-200 flex items-center justify-between gap-8 shrink-0">
        {/* Zone 1: Single-line Brand Wordmark */}
        <div className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          RasterZone OCR
        </div>

        {/* Zone 2: Clean Single-Line Navigation Links */}
        <nav className="flex items-center gap-6 text-sm font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('workspace')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'workspace'
                ? 'border-blue-600 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            แปลงภาพ & กำหนดพิกัด
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('results')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'results'
                ? 'border-blue-600 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            ตารางผลลัพธ์ ({mode === 'zones' ? zoneResults.length : fullPageResults.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'export'
                ? 'border-blue-600 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            ส่งออกเว็บแอปออฟไลน์
          </button>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="shrink-0">
          <button
            type="button"
            disabled={!hasExportableResults}
            onClick={() =>
              exportResultsToExcel({
                mode,
                zones,
                zoneResults,
                fullPageResults,
              })
            }
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>ส่งออก Excel (.xlsx)</span>
          </button>
        </div>
      </header>

      {/* Workspace Mode & OCR Execution Toolbar */}
      {activeTab !== 'export' && (
      <div className="px-6 py-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>โหมดถอดภาพ:</span>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200 overflow-x-auto">
            {(
              [
                { id: 'zones', label: 'จับพิกัดเฉพาะจุด' },
                { id: 'full-table', label: 'อ่านทั้งหน้า -> ตาราง Excel' },
                { id: 'hybrid', label: 'ผสม (พิกัด + ตาราง)' },
                { id: 'full-lines', label: 'ถอดทั้งหน้าเรียงบรรทัด' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setMode(item.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  mode === item.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {!isStandaloneOffline && (
            <div className="flex items-center bg-slate-100 p-0.5 rounded-md border border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => setOcrEngine('cloud')}
                className={`px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap shrink-0 ${
                  ocrEngine === 'cloud'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Cloud AI
              </button>
              <button
                type="button"
                onClick={() => setOcrEngine('offline')}
                className={`px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap shrink-0 ${
                  ocrEngine === 'offline'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Offline ในเครื่อง
              </button>
            </div>
          )}

          <select
            value={scanScope}
            onChange={(e) => setScanScope(e.target.value as 'current' | 'all')}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-700 font-medium"
          >
            <option value="all">ประมวลผลทุกหน้าในคิว ({totalPagesCount} หน้า)</option>
            <option value="current">ประมวลผลเฉพาะหน้าปัจจุบัน</option>
          </select>

          <button
            type="button"
            disabled={ocrRunning || documents.length === 0}
            onClick={handleRunOcr}
            className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            {ocrRunning ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="font-mono-tabular">
                  กำลังอ่านภาพ OCR ({ocrProgress?.done ?? 0}/{ocrProgress?.total ?? 0})
                </span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>เริ่มถอดภาพ OCR</span>
              </>
            )}
          </button>
        </div>
      </div>
      )}

      {/* Error Alert Strip */}
      {ocrError && (
        <div className="px-6 py-2 bg-rose-50 border-b border-rose-200 flex items-center justify-between gap-4 text-xs text-rose-800 shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{ocrError}</span>
          </div>
          <button
            type="button"
            onClick={() => setOcrError(null)}
            className="text-rose-700 font-semibold hover:underline"
          >
            ปิด
          </button>
        </div>
      )}

      {/* Main Viewport */}
      {activeTab === 'export' ? (
        <ExportAppPanel zones={zones} templates={templates} />
      ) : activeTab === 'workspace' ? (
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          <FileQueueSidebar
            documents={documents}
            activeDocId={activeDocId}
            activePageNumber={activePageNumber}
            rasterizing={rasterizing}
            preprocess={preprocess}
            onChangePreprocess={(patch) =>
              setPreprocess((prev) => ({ ...prev, ...patch }))
            }
            onFilesAdded={handleFilesAdded}
            onLoadSample={handleLoadSample}
            onSelectPage={handleSelectPage}
            onRemoveDoc={handleRemoveDoc}
          />

          <main className="flex-1 min-w-0 h-full overflow-hidden">
            <DocumentCanvas
              page={activePage}
              mode={mode}
              zones={zones}
              selectedZoneId={selectedZoneId}
              grayscale={preprocess.grayscale}
              contrastBoost={preprocess.contrastBoost}
              onSelectZone={setSelectedZoneId}
              onAddZone={(z) => setZones((prev) => [...prev, z])}
              onUpdateZone={(id, patch) =>
                setZones((prev) =>
                  prev.map((z) => (z.id === id ? { ...z, ...patch } : z))
                )
              }
              onDeleteZone={(id) => {
                setZones((prev) => prev.filter((z) => z.id !== id));
                if (selectedZoneId === id) setSelectedZoneId(null);
              }}
              onRotatePage={handleRotateActivePage}
            />
          </main>

          <ZoneInspector
            mode={mode}
            ocrEngine={ocrEngine}
            page={activePage}
            zones={zones}
            selectedZoneId={selectedZoneId}
            grayscale={preprocess.grayscale}
            contrastBoost={preprocess.contrastBoost}
            customHint={customHint}
            templates={templates}
            onChangeCustomHint={setCustomHint}
            onSelectZone={setSelectedZoneId}
            onUpdateZone={(id, patch) =>
              setZones((prev) =>
                prev.map((z) => (z.id === id ? { ...z, ...patch } : z))
              )
            }
            onDeleteZone={(id) => {
              setZones((prev) => prev.filter((z) => z.id !== id));
              if (selectedZoneId === id) setSelectedZoneId(null);
            }}
            onClearZones={() => {
              setZones([]);
              setSelectedZoneId(null);
            }}
            onSaveTemplate={handleSaveTemplate}
            onApplyTemplate={handleApplyTemplate}
            onDeleteTemplate={handleDeleteTemplate}
            onImportZonesJson={(imported) => {
              setZones(imported);
              setSelectedZoneId(imported[0]?.id ?? null);
            }}
          />
        </div>
      ) : (
        <ResultsPanel
          mode={mode}
          zones={zones}
          zoneResults={zoneResults}
          fullPageResults={fullPageResults}
          onUpdateZoneCell={(resultId, zoneId, newValue) => {
            setZoneResults((prev) =>
              prev.map((r) =>
                r.id === resultId
                  ? {
                      ...r,
                      cells: {
                        ...r.cells,
                        [zoneId]: {
                          ...r.cells[zoneId],
                          zoneId,
                          label: r.cells[zoneId]?.label || zoneId,
                          confidence: r.cells[zoneId]?.confidence || 'high',
                          value: newValue,
                        },
                      },
                    }
                  : r
              )
            );
          }}
          onUpdateFullPageKeyValue={(resultId, kvIdx, newValue) => {
            setFullPageResults((prev) =>
              prev.map((fp) => {
                if (fp.id !== resultId) return fp;
                const nextKv = [...fp.keyValues];
                if (nextKv[kvIdx]) {
                  nextKv[kvIdx] = { ...nextKv[kvIdx], value: newValue };
                }
                return { ...fp, keyValues: nextKv };
              })
            );
          }}
          onUpdateFullPageTableCell={(resultId, tableIdx, rowIdx, colIdx, newValue) => {
            setFullPageResults((prev) =>
              prev.map((fp) => {
                if (fp.id !== resultId) return fp;
                const nextTables = fp.tables.map((t, ti) => {
                  if (ti !== tableIdx) return t;
                  const nextRows = t.rows.map((row, ri) => {
                    if (ri !== rowIdx) return row;
                    const copy = [...row];
                    copy[colIdx] = newValue;
                    return copy;
                  });
                  return { ...t, rows: nextRows };
                });
                return { ...fp, tables: nextTables };
              })
            );
          }}
          onUpdateFullPageLineCell={(resultId, lineIdx, cellIdx, newValue) => {
            setFullPageResults((prev) =>
              prev.map((fp) => {
                if (fp.id !== resultId) return fp;
                const nextLines = fp.lines.map((l, li) => {
                  if (li !== lineIdx) return l;
                  const copy = [...l.cells];
                  copy[cellIdx] = newValue;
                  return { ...l, cells: copy };
                });
                return { ...fp, lines: nextLines };
              })
            );
          }}
        />
      )}
      <OfflineIndicator />
    </div>
  );
}

import React, { useRef, useState } from 'react';
import {
  Download,
  FileImage,
  FileText,
  FolderInput,
  Loader2,
  Sparkles,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type { DocumentItem, ImagePreprocessOptions } from '../types/ocr';
import { collectFilesFromDrop, isSupportedDocumentFile } from '../utils/rasterizer';

interface FileQueueSidebarProps {
  documents: DocumentItem[];
  activeDocId: string | null;
  activePageNumber: number;
  rasterizing: boolean;
  preprocess: ImagePreprocessOptions;
  onChangePreprocess: (next: Partial<ImagePreprocessOptions>) => void;
  onFilesAdded: (items: Array<{ file: File; relativePath: string }>) => void;
  onLoadSample: () => void;
  onSelectPage: (docId: string, pageNumber: number) => void;
  onRemoveDoc: (docId: string) => void;
}

export const FileQueueSidebar: React.FC<FileQueueSidebarProps> = ({
  documents,
  activeDocId,
  activePageNumber,
  rasterizing,
  preprocess,
  onChangePreprocess,
  onFilesAdded,
  onLoadSample,
  onSelectPage,
  onRemoveDoc,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const items = await collectFilesFromDrop(e.dataTransfer);
    if (items.length > 0) {
      onFilesAdded(items);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(isSupportedDocumentFile);
    if (files.length > 0) {
      onFilesAdded(
        files.map((f) => ({
          file: f,
          relativePath:
            (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
        }))
      );
    }
    e.target.value = '';
  };

  const handleChooseFolder = async () => {
    // Prefer standard folder picker input which works reliably across all browsers and iframes
    folderInputRef.current?.click();
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const activeDoc = documents.find((d) => d.id === activeDocId) ?? null;
  const activePage =
    activeDoc?.pages.find((p) => p.pageNumber === activePageNumber) ?? null;

  const handleDownloadActivePng = () => {
    if (!activeDoc || !activePage) return;
    const a = document.createElement('a');
    a.href = activePage.dataUrl;
    a.download = `${activeDoc.name.replace(/\.[^/.]+$/, '')}_page_${activePage.pageNumber}.png`;
    a.click();
  };

  return (
    <aside className="w-full lg:w-[280px] shrink-0 bg-white border-r border-slate-200 flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          คิวไฟล์ & แปลง PDF เป็นภาพ
        </h2>
        <span className="text-xs text-slate-500 font-mono-tabular">
          {documents.length} ไฟล์
        </span>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
        {/* Dropzone & Folder/Path Selection */}
        <div className="p-3.5 space-y-2.5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-blue-500 bg-blue-50'
                : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
            }`}
          >
            {rasterizing ? (
              <div className="py-2 flex flex-col items-center gap-2 text-blue-600">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-xs font-medium">
                  กำลังแปลง PDF เป็นภาพความละเอียดสูง...
                </span>
              </div>
            ) : (
              <>
                <UploadCloud className="w-6 h-6 text-slate-400 mx-auto mb-1.5" />
                <p className="text-xs font-semibold text-slate-800">
                  ลากวางไฟล์ PDF / รูปภาพสแกน / โฟลเดอร์
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  รองรับ PDF, PNG, JPG, WebP, TIFF (.tif)
                </p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff,.jfif,.avif,image/*,application/pdf"
            onChange={handleFileInput}
            className="hidden"
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={handleFileInput}
            className="hidden"
          />

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-md text-xs font-medium whitespace-nowrap shrink-0"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>เลือกไฟล์</span>
            </button>
            <button
              type="button"
              onClick={handleChooseFolder}
              className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-md text-xs font-medium whitespace-nowrap shrink-0"
            >
              <FolderInput className="w-3.5 h-3.5" />
              <span>เลือกโฟลเดอร์</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onLoadSample}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            <span>โหลดตัวอย่าง: ใบขนสินค้าขาออก</span>
          </button>
        </div>

        {/* Rasterization & Image Preprocessing Options */}
        <div className="p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-800">
              คุณภาพภาพที่ถอดจาก PDF
            </span>
            <span className="text-[11px] font-mono-tabular text-slate-500">
              {preprocess.dpi} DPI
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-md">
            {([150, 200, 300] as const).map((dpiVal) => (
              <button
                key={dpiVal}
                type="button"
                onClick={() => onChangePreprocess({ dpi: dpiVal })}
                className={`py-1 text-xs font-mono-tabular font-medium rounded transition-colors ${
                  preprocess.dpi === dpiVal
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {dpiVal} DPI
              </button>
            ))}
          </div>

          <div className="space-y-1.5 pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={preprocess.grayscale}
                onChange={(e) =>
                  onChangePreprocess({ grayscale: e.target.checked })
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>โหมดขาวดำ (Grayscale ก่อนอ่าน OCR)</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={preprocess.contrastBoost}
                onChange={(e) =>
                  onChangePreprocess({ contrastBoost: e.target.checked })
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>เพิ่มความคมชัดตัวอักษร (Contrast Boost)</span>
            </label>
          </div>
        </div>

        {/* Queued Files & Page Switcher */}
        <div className="p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-800">
              รายการไฟล์ในคิว
            </span>
            {activePage && (
              <button
                type="button"
                onClick={handleDownloadActivePng}
                className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
                title="บันทึกรูปภาพที่แปลงแล้วของหน้านี้"
              >
                <Download className="w-3 h-3" />
                <span>บันทึก PNG</span>
              </button>
            )}
          </div>

          {documents.length === 0 ? (
            <p className="text-xs text-slate-400 py-2">
              ยังไม่มีไฟล์ในคิว
            </p>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => {
                const isSelectedDoc = doc.id === activeDocId;
                return (
                  <div
                    key={doc.id}
                    className={`border rounded-md p-2.5 transition-colors ${
                      isSelectedDoc
                        ? 'border-blue-300 bg-blue-50/40'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectPage(doc.id, 1)}
                        className="flex items-start gap-2 text-left min-w-0 flex-1"
                      >
                        {doc.sourceType === 'pdf' ? (
                          <FileText className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        ) : (
                          <FileImage className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-slate-900 truncate">
                            {doc.name}
                          </div>
                          {doc.relativePath !== doc.name && (
                            <div className="text-[10px] text-slate-500 font-mono-tabular truncate">
                              {doc.relativePath}
                            </div>
                          )}
                          <div className="text-[11px] text-slate-500 font-mono-tabular mt-0.5">
                            {doc.pages.length} หน้า · {formatBytes(doc.fileSize)} · {doc.dpi} DPI
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => onRemoveDoc(doc.id)}
                        className="text-slate-400 hover:text-rose-600 p-0.5"
                        title="นำไฟล์ออก"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Page numbers strip for multi-page PDF */}
                    {doc.pages.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-200/70 flex flex-wrap gap-1">
                        {doc.pages.map((pg) => {
                          const isCurrentPage =
                            isSelectedDoc && pg.pageNumber === activePageNumber;
                          return (
                            <button
                              key={pg.pageNumber}
                              type="button"
                              onClick={() => onSelectPage(doc.id, pg.pageNumber)}
                              className={`px-2 py-0.5 text-[11px] font-mono-tabular rounded border transition-colors ${
                                isCurrentPage
                                  ? 'bg-blue-600 border-blue-600 text-white font-semibold'
                                  : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                              }`}
                            >
                              P{pg.pageNumber}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

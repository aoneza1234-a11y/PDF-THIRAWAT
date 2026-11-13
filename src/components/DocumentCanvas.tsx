import React, { useEffect, useRef, useState } from 'react';
import {
  Crosshair,
  Grid3X3,
  Maximize2,
  MousePointer2,
  Plus,
  RotateCw,
  SquareDashedMousePointer,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ExtractionMode, OcrZone, RenderedPage } from '../types/ocr';

interface DocumentCanvasProps {
  page: RenderedPage | null;
  mode: ExtractionMode;
  zones: OcrZone[];
  selectedZoneId: string | null;
  grayscale: boolean;
  contrastBoost: boolean;
  onSelectZone: (id: string | null) => void;
  onAddZone: (zone: OcrZone) => void;
  onUpdateZone: (id: string, patch: Partial<OcrZone>) => void;
  onDeleteZone: (id: string) => void;
  onRotatePage?: () => void;
}

type DragAction =
  | { type: 'draw'; startX: number; startY: number; curX: number; curY: number }
  | {
      type: 'move';
      zoneId: string;
      startMouseX: number;
      startMouseY: number;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
    }
  | {
      type: 'resize';
      zoneId: string;
      handle: string;
      startMouseX: number;
      startMouseY: number;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
    };

export const DocumentCanvas: React.FC<DocumentCanvasProps> = ({
  page,
  mode,
  zones,
  selectedZoneId,
  grayscale,
  contrastBoost,
  onSelectZone,
  onAddZone,
  onUpdateZone,
  onDeleteZone,
  onRotatePage,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState<number>(1);
  const [tool, setTool] = useState<'draw' | 'select'>('draw');
  const [snapMm, setSnapMm] = useState<boolean>(false);
  const [dragAction, setDragAction] = useState<DragAction | null>(null);
  const [cursorMm, setCursorMm] = useState<{ x: number; y: number } | null>(null);

  // Base display width at zoom 1.0 = 780px (fits crisp inside 1440px 3-column layout)
  const basePaperWidthPx = 760;
  const displayWidth = page ? Math.round(basePaperWidthPx * zoom) : 760;
  const displayHeight = page
    ? Math.round((page.heightPx / page.widthPx) * displayWidth)
    : 1075;

  const handleFitWidth = () => {
    if (!scrollContainerRef.current || !page) return;
    const avail = scrollContainerRef.current.clientWidth - 88;
    const nextZoom = Math.min(1.6, Math.max(0.5, avail / basePaperWidthPx));
    setZoom(Number(nextZoom.toFixed(2)));
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!selectedZoneId) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDeleteZone(selectedZoneId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedZoneId, onDeleteZone]);

  const toRatio = (clientX: number, clientY: number) => {
    const rect = paperRef.current?.getBoundingClientRect();
    if (!rect) return { rx: 0, ry: 0 };
    let rx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    let ry = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    if (snapMm && page) {
      const xMm = Math.round(rx * page.widthMm);
      const yMm = Math.round(ry * page.heightMm);
      rx = Math.min(1, Math.max(0, xMm / page.widthMm));
      ry = Math.min(1, Math.max(0, yMm / page.heightMm));
    }
    return { rx, ry };
  };

  const zonesAllowed = mode === 'zones' || mode === 'hybrid';

  const visibleZones = zones.filter((z) => {
    if (!page) return false;
    if (z.pageScope === 'all') return true;
    return z.pageScope === page.pageNumber;
  });

  const handlePaperPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!page || !zonesAllowed) return;
    if (e.button !== 0) return;

    if (tool === 'select') {
      onSelectZone(null);
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    const { rx, ry } = toRatio(e.clientX, e.clientY);
    onSelectZone(null);
    setDragAction({
      type: 'draw',
      startX: rx,
      startY: ry,
      curX: rx,
      curY: ry,
    });
  };

  const handlePaperPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!page) return;
    const { rx, ry } = toRatio(e.clientX, e.clientY);
    setCursorMm({
      x: Number((rx * page.widthMm).toFixed(1)),
      y: Number((ry * page.heightMm).toFixed(1)),
    });

    if (!dragAction) return;

    if (dragAction.type === 'draw') {
      setDragAction({ ...dragAction, curX: rx, curY: ry });
    } else if (dragAction.type === 'move') {
      const dx = rx - dragAction.startMouseX;
      const dy = ry - dragAction.startMouseY;
      const nextX = Math.min(1 - dragAction.origW, Math.max(0, dragAction.origX + dx));
      const nextY = Math.min(1 - dragAction.origH, Math.max(0, dragAction.origY + dy));
      onUpdateZone(dragAction.zoneId, { xRatio: nextX, yRatio: nextY });
    } else if (dragAction.type === 'resize') {
      const dx = rx - dragAction.startMouseX;
      const dy = ry - dragAction.startMouseY;
      let { origX: x, origY: y, origW: w, origH: h } = dragAction;
      const minRatio = 0.015;

      if (dragAction.handle.includes('e')) {
        w = Math.min(1 - x, Math.max(minRatio, w + dx));
      }
      if (dragAction.handle.includes('s')) {
        h = Math.min(1 - y, Math.max(minRatio, h + dy));
      }
      if (dragAction.handle.includes('w')) {
        const right = x + w;
        const nextX = Math.min(right - minRatio, Math.max(0, x + dx));
        w = right - nextX;
        x = nextX;
      }
      if (dragAction.handle.includes('n')) {
        const bottom = y + h;
        const nextY = Math.min(bottom - minRatio, Math.max(0, y + dy));
        h = bottom - nextY;
        y = nextY;
      }

      onUpdateZone(dragAction.zoneId, {
        xRatio: x,
        yRatio: y,
        wRatio: w,
        hRatio: h,
      });
    }
  };

  const handlePaperPointerUp = () => {
    if (!dragAction) return;
    if (dragAction.type === 'draw') {
      const x = Math.min(dragAction.startX, dragAction.curX);
      const y = Math.min(dragAction.startY, dragAction.curY);
      const w = Math.abs(dragAction.curX - dragAction.startX);
      const h = Math.abs(dragAction.curY - dragAction.startY);

      if (w > 0.015 && h > 0.01) {
        const nextIdx = zones.length + 1;
        const newZone: OcrZone = {
          id: `zone_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          label: `กรอบข้อมูล ${nextIdx}`,
          dataType: 'text',
          xRatio: x,
          yRatio: y,
          wRatio: w,
          hRatio: h,
          pageScope: 'all',
        };
        onAddZone(newZone);
        onSelectZone(newZone.id);
      }
    }
    setDragAction(null);
  };

  // Ruler ticks every 10mm, major labeled ticks every 50mm
  const xTicksMm = page
    ? Array.from({ length: Math.floor(page.widthMm / 10) + 1 }, (_, i) => i * 10)
    : [];
  const yTicksMm = page
    ? Array.from({ length: Math.floor(page.heightMm / 10) + 1 }, (_, i) => i * 10)
    : [];

  const filterCss = [
    grayscale ? 'grayscale(100%)' : '',
    contrastBoost ? 'contrast(145%)' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col h-full bg-slate-700 select-none overflow-hidden">
      {/* Canvas Control Bar */}
      <div className="flex items-center justify-between gap-4 px-4 py-2 bg-slate-800 border-b border-slate-700 text-slate-200 text-xs">
        <div className="flex items-center gap-2">
          {zonesAllowed ? (
            <div className="flex items-center bg-slate-900/70 p-0.5 rounded-md border border-slate-700">
              <button
                type="button"
                onClick={() => setTool('draw')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  tool === 'draw'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <SquareDashedMousePointer className="w-3.5 h-3.5" />
                <span>ลากวาดกรอบพิกัด</span>
              </button>
              <button
                type="button"
                onClick={() => setTool('select')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  tool === 'select'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <MousePointer2 className="w-3.5 h-3.5" />
                <span>เลือก / เลื่อนกรอบ</span>
              </button>
            </div>
          ) : (
            <span className="text-slate-300 font-medium">
              {mode === 'full-table'
                ? 'โหมดอ่านทั้งหน้าอัตโนมัติ (Full-Page Table OCR) — ไม่ต้องวาดกรอบ'
                : 'โหมดถอดข้อความทั้งหน้าเรียงบรรทัด (Full-Page Lines) — ไม่ต้องวาดกรอบ'}
            </span>
          )}

          {zonesAllowed && (
            <button
              type="button"
              onClick={() => setSnapMm((s) => !s)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs transition-colors whitespace-nowrap shrink-0 ${
                snapMm
                  ? 'bg-slate-700 border-blue-400 text-blue-200'
                  : 'border-slate-600 text-slate-300 hover:border-slate-500'
              }`}
              title="ยึดพิกัดทีละ 1 มิลลิเมตร"
            >
              <Grid3X3 className="w-3.5 h-3.5" />
              <span>Snap 1mm</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {page && onRotatePage && (
            <button
              type="button"
              onClick={onRotatePage}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-600 text-slate-200 hover:border-slate-500 hover:bg-slate-700 text-xs transition-colors whitespace-nowrap shrink-0"
              title="หมุนภาพเอกสาร 90 องศา"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>หมุน 90°</span>
            </button>
          )}

          {cursorMm && page && (
            <div className="hidden xl:flex items-center gap-1.5 text-slate-300 font-mono-tabular">
              <Crosshair className="w-3.5 h-3.5 text-slate-400" />
              <span>
                {cursorMm.x.toFixed(1)}, {cursorMm.y.toFixed(1)} mm
              </span>
            </div>
          )}

          <div className="flex items-center gap-1 bg-slate-900/70 px-1.5 py-0.5 rounded-md border border-slate-700">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.15).toFixed(2))))}
              className="p-1 text-slate-300 hover:text-white rounded"
              title="ย่อ"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 font-mono-tabular text-xs text-slate-200 min-w-[48px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(2.2, Number((z + 0.15).toFixed(2))))}
              className="p-1 text-slate-300 hover:text-white rounded"
              title="ขยาย"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleFitWidth}
              className="p-1 text-slate-300 hover:text-white rounded border-l border-slate-700 pl-1.5 ml-0.5"
              title="พอดีความกว้าง"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Drafting Stage Viewport */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto p-6 flex justify-center items-start"
      >
        {!page ? (
          <div className="my-auto text-center max-w-md bg-slate-800/80 border border-slate-600 rounded-lg p-8 text-slate-200">
            <p className="text-base font-semibold mb-2">ยังไม่มีเอกสารบนพื้นที่ทำงาน</p>
            <p className="text-xs text-slate-400 leading-relaxed">
              ลากวางไฟล์ PDF / รูปภาพ หรือเลือกโฟลเดอร์จากแถบด้านซ้าย ระบบจะแปลงทุกหน้าของ PDF
              เป็นภาพความละเอียดสูง (Raster Image) เพื่อให้คุณกำหนดพิกัด OCR หรือถอดข้อมูลทั้งหน้าเป็น Excel
            </p>
          </div>
        ) : (
          <div className="relative inline-block pb-10 pr-8 pl-3">
            {/* Corner unit indicator */}
            <div
              className="absolute top-0 left-0 w-9 h-7 bg-white border-r border-b border-slate-300 flex items-center justify-center text-[10px] font-mono-tabular font-semibold text-slate-600 z-20"
              style={{ transform: 'translate(-24px, -28px)' }}
            >
              mm
            </div>

            {/* Top Millimeter Ruler */}
            <div
              className="absolute left-3 bg-white border-b border-slate-300 h-7 overflow-hidden z-10 shadow-sm"
              style={{
                width: `${displayWidth}px`,
                top: '-28px',
              }}
            >
              {xTicksMm.map((mm) => {
                const leftPx = (mm / page.widthMm) * displayWidth;
                const isMajor = mm % 50 === 0;
                return (
                  <div
                    key={mm}
                    className="absolute bottom-0 border-l border-slate-400"
                    style={{
                      left: `${leftPx}px`,
                      height: isMajor ? '10px' : '5px',
                    }}
                  >
                    {isMajor && mm > 0 && (
                      <span className="absolute -top-4 -translate-x-1/2 text-[10px] font-mono-tabular font-semibold text-slate-700">
                        {mm}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Left Millimeter Ruler */}
            <div
              className="absolute top-0 bg-white border-r border-slate-300 w-9 overflow-hidden z-10 shadow-sm"
              style={{
                height: `${displayHeight}px`,
                left: '-24px',
              }}
            >
              {yTicksMm.map((mm) => {
                const topPx = (mm / page.heightMm) * displayHeight;
                const isMajor = mm % 50 === 0;
                return (
                  <div
                    key={mm}
                    className="absolute right-0 border-t border-slate-400"
                    style={{
                      top: `${topPx}px`,
                      width: isMajor ? '10px' : '5px',
                    }}
                  >
                    {isMajor && mm > 0 && (
                      <span className="absolute right-3 -translate-y-1/2 text-[10px] font-mono-tabular font-semibold text-slate-700">
                        {mm}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Paper Raster Surface */}
            <div
              ref={paperRef}
              onPointerDown={handlePaperPointerDown}
              onPointerMove={handlePaperPointerMove}
              onPointerUp={handlePaperPointerUp}
              onPointerLeave={() => setCursorMm(null)}
              className={`relative bg-white shadow-2xl overflow-visible ${
                zonesAllowed && tool === 'draw' ? 'cursor-crosshair' : 'cursor-default'
              }`}
              style={{
                width: `${displayWidth}px`,
                height: `${displayHeight}px`,
              }}
            >
              <img
                src={page.dataUrl}
                alt={`Page ${page.pageNumber}`}
                draggable={false}
                className="w-full h-full block pointer-events-none"
                style={{ filter: filterCss || undefined }}
              />

              {/* Full-page mode scan frame indicator */}
              {!zonesAllowed && (
                <div className="absolute inset-2 border-2 border-dashed border-emerald-500/80 bg-emerald-500/5 pointer-events-none">
                  <div className="absolute top-2 left-2 bg-emerald-700 text-white text-[11px] font-medium px-2.5 py-1 rounded shadow-sm">
                    {mode === 'full-table'
                      ? 'สแกนทั้งหน้าอัตโนมัติ (Full-Page Table & Fields)'
                      : 'สแกนทั้งหน้าเรียงบรรทัด (Full-Page Line Grid)'}
                  </div>
                </div>
              )}

              {/* Drawn OCR Zone Overlays */}
              {zonesAllowed &&
                visibleZones.map((zone) => {
                  const isSelected = zone.id === selectedZoneId;
                  const isTableZone = zone.dataType === 'table';
                  const xMm = Math.round(zone.xRatio * page.widthMm);
                  const yMm = Math.round(zone.yRatio * page.heightMm);

                  const borderColor = isSelected
                    ? 'border-rose-600 bg-rose-500/12'
                    : isTableZone
                    ? 'border-amber-600 border-dashed bg-amber-500/10 hover:bg-amber-500/15'
                    : 'border-blue-600 border-dashed bg-blue-500/10 hover:bg-blue-500/15';

                  const tagColor = isSelected
                    ? 'bg-rose-600 text-white'
                    : isTableZone
                    ? 'bg-amber-600 text-white'
                    : 'bg-blue-600 text-white';

                  return (
                    <div
                      key={zone.id}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onSelectZone(zone.id);
                        const { rx, ry } = toRatio(e.clientX, e.clientY);
                        setDragAction({
                          type: 'move',
                          zoneId: zone.id,
                          startMouseX: rx,
                          startMouseY: ry,
                          origX: zone.xRatio,
                          origY: zone.yRatio,
                          origW: zone.wRatio,
                          origH: zone.hRatio,
                        });
                      }}
                      className={`absolute border-2 transition-colors ${borderColor} ${
                        isSelected ? 'z-30 cursor-move' : 'z-20 cursor-pointer'
                      }`}
                      style={{
                        left: `${zone.xRatio * 100}%`,
                        top: `${zone.yRatio * 100}%`,
                        width: `${zone.wRatio * 100}%`,
                        height: `${zone.hRatio * 100}%`,
                      }}
                    >
                      {/* Floating Label Badge (matching reference style) */}
                      <div
                        className={`absolute -top-5 left-0 flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap shadow-sm pointer-events-none ${tagColor}`}
                      >
                        <span>{zone.label}</span>
                        {isSelected && (
                          <span className="font-mono-tabular opacity-90">
                            ({xMm}, {yMm} mm)
                          </span>
                        )}
                      </div>

                      {/* Quick Delete button on selected box */}
                      {isSelected && (
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteZone(zone.id);
                          }}
                          className="absolute -top-5 -right-0.5 bg-slate-900 text-white p-0.5 rounded hover:bg-rose-700 shadow-sm"
                          title="ลบกรอบนี้"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}

                      {/* 8 Resize Handles when selected */}
                      {isSelected &&
                        (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map(
                          (handle) => {
                            const posClass: Record<string, string> = {
                              nw: '-top-1.5 -left-1.5 cursor-nwse-resize',
                              n: '-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize',
                              ne: '-top-1.5 -right-1.5 cursor-nesw-resize',
                              e: 'top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize',
                              se: '-bottom-1.5 -right-1.5 cursor-nwse-resize',
                              s: '-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize',
                              sw: '-bottom-1.5 -left-1.5 cursor-nesw-resize',
                              w: 'top-1/2 -left-1.5 -translate-y-1/2 cursor-ew-resize',
                            };
                            return (
                              <div
                                key={handle}
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  const { rx, ry } = toRatio(e.clientX, e.clientY);
                                  setDragAction({
                                    type: 'resize',
                                    zoneId: zone.id,
                                    handle,
                                    startMouseX: rx,
                                    startMouseY: ry,
                                    origX: zone.xRatio,
                                    origY: zone.yRatio,
                                    origW: zone.wRatio,
                                    origH: zone.hRatio,
                                  });
                                }}
                                className={`absolute w-2.5 h-2.5 bg-white border-2 border-rose-600 rounded-[2px] ${posClass[handle]}`}
                              />
                            );
                          }
                        )}
                    </div>
                  );
                })}

              {/* Active drawing rectangle preview */}
              {dragAction?.type === 'draw' && (
                <div
                  className="absolute border-2 border-rose-600 bg-rose-500/15 pointer-events-none z-40"
                  style={{
                    left: `${Math.min(dragAction.startX, dragAction.curX) * 100}%`,
                    top: `${Math.min(dragAction.startY, dragAction.curY) * 100}%`,
                    width: `${Math.abs(dragAction.curX - dragAction.startX) * 100}%`,
                    height: `${Math.abs(dragAction.curY - dragAction.startY) * 100}%`,
                  }}
                >
                  <div className="absolute -top-5 left-0 bg-rose-600 text-white text-[10px] font-mono-tabular px-1.5 py-0.5 rounded whitespace-nowrap">
                    {Math.round(Math.abs(dragAction.curX - dragAction.startX) * page.widthMm)} ×{' '}
                    {Math.round(Math.abs(dragAction.curY - dragAction.startY) * page.heightMm)} mm
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom quick hint */}
      {zonesAllowed && page && (
        <div className="px-4 py-1.5 bg-slate-800 border-t border-slate-700 text-[11px] text-slate-300 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span>คลิกลากบนกระดาษเพื่อสร้างกรอบพิกัด OCR</span>
            <span aria-hidden="true">·</span>
            <span>คลิกกรอบเพื่อเลื่อน/ปรับขนาด หรือกด Delete เพื่อลบ</span>
          </div>
          <button
            type="button"
            onClick={() => {
              const newZone: OcrZone = {
                id: `zone_${Date.now()}`,
                label: `กรอบข้อมูล ${zones.length + 1}`,
                dataType: mode === 'hybrid' ? 'table' : 'text',
                xRatio: 0.1,
                yRatio: 0.15,
                wRatio: 0.28,
                hRatio: 0.06,
                pageScope: 'all',
              };
              onAddZone(newZone);
              onSelectZone(newZone.id);
            }}
            className="flex items-center gap-1 text-blue-300 hover:text-blue-200 font-medium whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>เพิ่มกรอบกลางหน้า</span>
          </button>
        </div>
      )}
    </div>
  );
};

import React, { useState } from 'react';
import {
  Check,
  Copy,
  FileSpreadsheet,
  FileText,
  Table2,
} from 'lucide-react';
import type {
  ExtractionMode,
  FullPageResult,
  OcrZone,
  ZonePageResult,
} from '../types/ocr';
import {
  buildFlatMatrix,
  exportResultsToCsv,
  exportResultsToExcel,
} from '../utils/excelExport';

interface ResultsPanelProps {
  mode: ExtractionMode;
  zones: OcrZone[];
  zoneResults: ZonePageResult[];
  fullPageResults: FullPageResult[];
  onUpdateZoneCell: (resultId: string, zoneId: string, newValue: string) => void;
  onUpdateFullPageTableCell: (
    resultId: string,
    tableIdx: number,
    rowIdx: number,
    colIdx: number,
    newValue: string
  ) => void;
  onUpdateFullPageKeyValue: (
    resultId: string,
    kvIdx: number,
    newValue: string
  ) => void;
  onUpdateFullPageLineCell: (
    resultId: string,
    lineIdx: number,
    cellIdx: number,
    newValue: string
  ) => void;
}

export const ResultsPanel: React.FC<ResultsPanelProps> = ({
  mode,
  zones,
  zoneResults,
  fullPageResults,
  onUpdateZoneCell,
  onUpdateFullPageTableCell,
  onUpdateFullPageKeyValue,
  onUpdateFullPageLineCell,
}) => {
  const [copied, setCopied] = useState(false);

  const hasZoneData = zoneResults.length > 0;
  const hasFullData = fullPageResults.length > 0;
  const hasAnyData =
    mode === 'zones'
      ? hasZoneData
      : mode === 'hybrid'
      ? hasZoneData || hasFullData
      : hasFullData;

  const handleCopyTsv = async () => {
    const matrix = buildFlatMatrix({
      mode,
      zones,
      zoneResults,
      fullPageResults,
    });
    const tsv = matrix.map((r) => r.map((c) => String(c ?? '')).join('\t')).join('\n');
    await navigator.clipboard.writeText(tsv);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (!hasAnyData) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 p-8">
        <div className="max-w-md text-center bg-white border border-slate-200 rounded-lg p-8">
          <Table2 className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-900 mb-1.5">
            ยังไม่มีผลลัพธ์สำหรับส่งออก Excel
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            กรุณาเลือกเอกสารและโหมดการอ่านด้านบน จากนั้นกดปุ่ม{' '}
            <strong className="text-slate-800">เริ่มถอดภาพ OCR</strong>{' '}
            ระบบจะแสดงตารางข้อมูลที่ถอดได้เพื่อให้คุณตรวจสอบและแก้ไขก่อนส่งออกเป็นไฟล์{' '}
            <code className="font-mono-tabular">.xlsx</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
      {/* Results Action Header */}
      <div className="px-6 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            ตารางผลลัพธ์ OCR (สามารถคลิกแก้ไขข้อมูลในช่องก่อนส่งออกได้)
          </h2>
          <p className="text-xs text-slate-500">
            โหมดที่ใช้งาน:{' '}
            <span className="font-medium text-slate-700">
              {mode === 'zones'
                ? 'จับพิกัดเฉพาะจุด (Zone Coordinate OCR)'
                : mode === 'full-table'
                ? 'อ่านทั้งหน้าอัตโนมัติ (Full-Page Tables & Fields)'
                : mode === 'hybrid'
                ? 'โหมดผสม (พิกัดหัวเอกสาร + ตารางรายการ)'
                : 'ถอดข้อความทั้งหน้าเรียงบรรทัด (Full-Page Lines)'}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopyTsv}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span>{copied ? 'คัดลอกแล้ว' : 'คัดลอกลง Excel (TSV)'}</span>
          </button>

          <button
            type="button"
            onClick={() =>
              exportResultsToCsv({ mode, zones, zoneResults, fullPageResults })
            }
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>ส่งออก CSV</span>
          </button>

          <button
            type="button"
            onClick={() =>
              exportResultsToExcel({ mode, zones, zoneResults, fullPageResults })
            }
            className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>ดาวน์โหลด Excel (.xlsx)</span>
          </button>
        </div>
      </div>

      {/* Spreadsheet Grid Content */}
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Zone OCR Grid (for zones & hybrid modes) */}
        {(mode === 'zones' || mode === 'hybrid') && zoneResults.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-800">
                {mode === 'hybrid'
                  ? 'ข้อมูลหัวเอกสารจากพิกัดที่เลือก (Header Zones)'
                  : 'ข้อมูลที่ถอดได้จากพิกัดกรอบ (Zone OCR Sheet)'}
              </h3>
              <span className="text-xs text-slate-500 font-mono-tabular">
                {zoneResults.length} แถว · {zones.filter((z) => mode === 'zones' || z.dataType !== 'table').length} คอลัมน์
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-700">
                    <th className="px-3 py-2 font-semibold border-r border-slate-200 whitespace-nowrap">
                      ไฟล์ / Path
                    </th>
                    <th className="px-3 py-2 font-semibold border-r border-slate-200 whitespace-nowrap text-center">
                      หน้า
                    </th>
                    {zones
                      .filter((z) => mode === 'zones' || z.dataType !== 'table')
                      .map((z) => (
                        <th
                          key={z.id}
                          className="px-3 py-2 font-semibold border-r border-slate-200 whitespace-nowrap min-w-[160px]"
                        >
                          {z.label}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {zoneResults.map((res) => (
                    <tr key={res.id} className="hover:bg-blue-50/40">
                      <td className="px-3 py-2 border-r border-slate-200 font-mono-tabular text-slate-700 whitespace-nowrap max-w-[220px] truncate">
                        {res.relativePath || res.docName}
                      </td>
                      <td className="px-3 py-2 border-r border-slate-200 font-mono-tabular text-center text-slate-600">
                        {res.pageNumber}
                      </td>
                      {zones
                        .filter((z) => mode === 'zones' || z.dataType !== 'table')
                        .map((z) => {
                          const cell = res.cells[z.id];
                          return (
                            <td
                              key={z.id}
                              className="p-1 border-r border-slate-200 align-top"
                            >
                              <input
                                type="text"
                                value={cell?.value ?? ''}
                                onChange={(e) =>
                                  onUpdateZoneCell(res.id, z.id, e.target.value)
                                }
                                className="w-full px-2 py-1 text-xs text-slate-900 bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 rounded font-mono-tabular"
                              />
                            </td>
                          );
                        })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Full-Page / Hybrid Tables & Key-Values */}
        {(mode === 'full-table' || mode === 'hybrid') &&
          fullPageResults.map((fp) => (
            <div key={fp.id} className="space-y-4">
              {mode === 'full-table' && fp.keyValues.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-slate-800">
                      สรุปหัวข้อเอกสาร: {fp.documentTitle} ({fp.docName} · หน้า {fp.pageNumber})
                    </h3>
                    <span className="text-xs text-slate-500 font-mono-tabular">
                      {fp.keyValues.length} รายการ
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 text-slate-700">
                          <th className="px-3 py-2 font-semibold border-r border-slate-200 w-1/3">
                            หัวข้อ (Field)
                          </th>
                          <th className="px-3 py-2 font-semibold">
                            ค่าที่อ่านได้ (Value)
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {fp.keyValues.map((kv, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="px-3 py-2 border-r border-slate-200 font-medium text-slate-700">
                              {kv.key}
                            </td>
                            <td className="p-1">
                              <input
                                type="text"
                                value={kv.value}
                                onChange={(e) =>
                                  onUpdateFullPageKeyValue(fp.id, idx, e.target.value)
                                }
                                className="w-full px-2 py-1 text-xs text-slate-900 bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {fp.tables.map((tbl, tIdx) => (
                <div
                  key={tIdx}
                  className="bg-white border border-slate-200 rounded-lg overflow-hidden"
                >
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-slate-800">
                      ตาราง: {tbl.tableName || `ตารางที่ ${tIdx + 1}`} ({fp.docName} · หน้า{' '}
                      {fp.pageNumber})
                    </h3>
                    <span className="text-xs text-slate-500 font-mono-tabular">
                      {tbl.rows.length} แถว
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 text-slate-700">
                          {tbl.headers.map((h, hIdx) => (
                            <th
                              key={hIdx}
                              className="px-3 py-2 font-semibold border-r border-slate-200 whitespace-nowrap"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {tbl.rows.map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-blue-50/40">
                            {tbl.headers.map((_, cIdx) => (
                              <td key={cIdx} className="p-1 border-r border-slate-200">
                                <input
                                  type="text"
                                  value={row[cIdx] ?? ''}
                                  onChange={(e) =>
                                    onUpdateFullPageTableCell(
                                      fp.id,
                                      tIdx,
                                      rIdx,
                                      cIdx,
                                      e.target.value
                                    )
                                  }
                                  className="w-full px-2 py-1 text-xs text-slate-900 bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 rounded font-mono-tabular"
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ))}

        {/* Full-Lines Mode Grid */}
        {mode === 'full-lines' &&
          fullPageResults.map((fp) => {
            const maxCols = Math.max(
              1,
              ...fp.lines.map((l) => l.cells.length)
            );
            return (
              <div
                key={fp.id}
                className="bg-white border border-slate-200 rounded-lg overflow-hidden"
              >
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-800">
                    {fp.relativePath || fp.docName} · หน้า {fp.pageNumber} ({fp.documentTitle})
                  </h3>
                  <span className="text-xs text-slate-500 font-mono-tabular">
                    {fp.lines.length} บรรทัด
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 text-slate-700">
                        <th className="px-3 py-2 font-semibold border-r border-slate-200 w-16 text-center">
                          บรรทัด
                        </th>
                        {Array.from({ length: maxCols }, (_, i) => (
                          <th
                            key={i}
                            className="px-3 py-2 font-semibold border-r border-slate-200"
                          >
                            Col {i + 1}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {fp.lines.map((line, lIdx) => (
                        <tr key={lIdx} className="hover:bg-blue-50/40">
                          <td className="px-3 py-1.5 border-r border-slate-200 font-mono-tabular text-center text-slate-500">
                            {line.lineNo}
                          </td>
                          {Array.from({ length: maxCols }, (_, cIdx) => (
                            <td key={cIdx} className="p-1 border-r border-slate-200">
                              <input
                                type="text"
                                value={line.cells[cIdx] ?? ''}
                                onChange={(e) =>
                                  onUpdateFullPageLineCell(
                                    fp.id,
                                    lIdx,
                                    cIdx,
                                    e.target.value
                                  )
                                }
                                className="w-full px-2 py-1 text-xs text-slate-900 bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
};

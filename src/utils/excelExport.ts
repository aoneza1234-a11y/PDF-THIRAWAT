import * as XLSX from 'xlsx';
import type {
  ExtractionMode,
  FullPageResult,
  OcrZone,
  ZonePageResult,
} from '../types/ocr';

function computeAutoCols(rows: Array<Array<string | number>>): XLSX.ColInfo[] {
  const maxCols = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const widths: number[] = Array(maxCols).fill(12);

  for (const row of rows) {
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c] ?? '');
      // Give Thai characters slightly extra width margin
      const len = Math.min(60, Math.max(10, val.length + 4));
      if (len > widths[c]) widths[c] = len;
    }
  }

  return widths.map((wch) => ({ wch }));
}

function sanitizeSheetName(name: string, used: Set<string>): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, '_').trim().slice(0, 28) || 'Sheet';
  let candidate = cleaned;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${cleaned.slice(0, 24)}_${counter}`;
    counter++;
  }
  used.add(candidate);
  return candidate;
}

export function exportResultsToExcel(params: {
  mode: ExtractionMode;
  zones: OcrZone[];
  zoneResults: ZonePageResult[];
  fullPageResults: FullPageResult[];
  fileName?: string;
}): void {
  const { mode, zones, zoneResults, fullPageResults, fileName } = params;
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  if (mode === 'zones') {
    const headers = ['ไฟล์ (File Path)', 'หน้า (Page)', ...zones.map((z) => z.label)];
    const aoa: Array<Array<string | number>> = [headers];

    for (const res of zoneResults) {
      const row: Array<string | number> = [
        res.relativePath || res.docName,
        res.pageNumber,
        ...zones.map((z) => res.cells[z.id]?.value ?? ''),
      ];
      aoa.push(row);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = computeAutoCols(aoa);
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName('Zone_OCR_Data', usedNames));
  } else if (mode === 'hybrid') {
    // Sheet 1: Combined Header Zones + Table Line Items
    const headerZones = zones.filter((z) => z.dataType !== 'table');
    const firstTable = fullPageResults.find((r) => r.tables.length > 0)?.tables[0];
    const tableHeaders = firstTable?.headers ?? ['รายการ'];

    const combinedHeaders = [
      'ไฟล์ (File Path)',
      'หน้า (Page)',
      ...headerZones.map((z) => z.label),
      ...tableHeaders,
    ];
    const combinedAoa: Array<Array<string | number>> = [combinedHeaders];

    for (const fp of fullPageResults) {
      const matchedZone = zoneResults.find(
        (zr) => zr.docId === fp.docId && zr.pageNumber === fp.pageNumber
      );
      const zoneVals = headerZones.map((z) => matchedZone?.cells[z.id]?.value ?? '');

      if (fp.tables.length === 0) {
        combinedAoa.push([fp.relativePath || fp.docName, fp.pageNumber, ...zoneVals]);
      } else {
        for (const tbl of fp.tables) {
          for (const row of tbl.rows) {
            combinedAoa.push([
              fp.relativePath || fp.docName,
              fp.pageNumber,
              ...zoneVals,
              ...row,
            ]);
          }
        }
      }
    }

    const wsCombined = XLSX.utils.aoa_to_sheet(combinedAoa);
    wsCombined['!cols'] = computeAutoCols(combinedAoa);
    XLSX.utils.book_append_sheet(
      wb,
      wsCombined,
      sanitizeSheetName('Hybrid_Combined', usedNames)
    );

    // Sheet 2: Header Zones Summary
    if (zoneResults.length > 0 && headerZones.length > 0) {
      const sumHeaders = ['ไฟล์ (File Path)', 'หน้า (Page)', ...headerZones.map((z) => z.label)];
      const sumAoa: Array<Array<string | number>> = [sumHeaders];
      for (const zr of zoneResults) {
        sumAoa.push([
          zr.relativePath || zr.docName,
          zr.pageNumber,
          ...headerZones.map((z) => zr.cells[z.id]?.value ?? ''),
        ]);
      }
      const wsSum = XLSX.utils.aoa_to_sheet(sumAoa);
      wsSum['!cols'] = computeAutoCols(sumAoa);
      XLSX.utils.book_append_sheet(
        wb,
        wsSum,
        sanitizeSheetName('Header_Zones', usedNames)
      );
    }
  } else if (mode === 'full-table') {
    // Sheet 1: Key-Value Summary across all pages
    const kvAoa: Array<Array<string | number>> = [
      ['ไฟล์ (File Path)', 'หน้า (Page)', 'ชื่อเอกสาร', 'หัวข้อ (Field)', 'ค่าที่อ่านได้ (Value)'],
    ];

    for (const fp of fullPageResults) {
      for (const kv of fp.keyValues) {
        kvAoa.push([
          fp.relativePath || fp.docName,
          fp.pageNumber,
          fp.documentTitle,
          kv.key,
          kv.value,
        ]);
      }
    }

    const wsKv = XLSX.utils.aoa_to_sheet(kvAoa);
    wsKv['!cols'] = computeAutoCols(kvAoa);
    XLSX.utils.book_append_sheet(
      wb,
      wsKv,
      sanitizeSheetName('Summary_Fields', usedNames)
    );

    // Additional sheets for tables
    const consolidatedTableRows: Array<Array<string | number>> = [];
    let primaryHeaders: string[] = [];

    for (const fp of fullPageResults) {
      fp.tables.forEach((tbl, idx) => {
        if (primaryHeaders.length === 0 && tbl.headers.length > 0) {
          primaryHeaders = ['ไฟล์ (File Path)', 'หน้า (Page)', ...tbl.headers];
          consolidatedTableRows.push(primaryHeaders);
        }
        for (const r of tbl.rows) {
          consolidatedTableRows.push([fp.relativePath || fp.docName, fp.pageNumber, ...r]);
        }

        const singleAoa: Array<Array<string | number>> = [
          tbl.headers.length > 0 ? tbl.headers : ['Column 1'],
          ...tbl.rows,
        ];
        const wsTbl = XLSX.utils.aoa_to_sheet(singleAoa);
        wsTbl['!cols'] = computeAutoCols(singleAoa);
        XLSX.utils.book_append_sheet(
          wb,
          wsTbl,
          sanitizeSheetName(`P${fp.pageNumber}_${tbl.tableName || `Table_${idx + 1}`}`, usedNames)
        );
      });
    }

    if (consolidatedTableRows.length > 1) {
      const wsAllTbl = XLSX.utils.aoa_to_sheet(consolidatedTableRows);
      wsAllTbl['!cols'] = computeAutoCols(consolidatedTableRows);
      XLSX.utils.book_append_sheet(
        wb,
        wsAllTbl,
        sanitizeSheetName('All_Tables', usedNames)
      );
    }
  } else {
    // full-lines mode
    const maxCells = fullPageResults.reduce(
      (m, fp) => Math.max(m, ...fp.lines.map((l) => l.cells.length), 1),
      1
    );
    const headers = [
      'ไฟล์ (File Path)',
      'หน้า (Page)',
      'บรรทัด',
      ...Array.from({ length: maxCells }, (_, i) => `Col ${i + 1}`),
    ];
    const aoa: Array<Array<string | number>> = [headers];

    for (const fp of fullPageResults) {
      for (const line of fp.lines) {
        aoa.push([
          fp.relativePath || fp.docName,
          fp.pageNumber,
          line.lineNo,
          ...line.cells,
        ]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = computeAutoCols(aoa);
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName('Full_Page_Lines', usedNames));
  }

  const outName =
    fileName ||
    `rasterzone_ocr_${mode}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, outName);
}

export function buildFlatMatrix(params: {
  mode: ExtractionMode;
  zones: OcrZone[];
  zoneResults: ZonePageResult[];
  fullPageResults: FullPageResult[];
}): Array<Array<string | number>> {
  const { mode, zones, zoneResults, fullPageResults } = params;
  if (mode === 'zones') {
    return [
      ['ไฟล์ (File Path)', 'หน้า', ...zones.map((z) => z.label)],
      ...zoneResults.map((r) => [
        r.relativePath || r.docName,
        r.pageNumber,
        ...zones.map((z) => r.cells[z.id]?.value ?? ''),
      ]),
    ];
  }

  if (mode === 'full-lines') {
    const maxCells = fullPageResults.reduce(
      (m, fp) => Math.max(m, ...fp.lines.map((l) => l.cells.length), 1),
      1
    );
    return [
      ['ไฟล์', 'หน้า', 'บรรทัด', ...Array.from({ length: maxCells }, (_, i) => `Col ${i + 1}`)],
      ...fullPageResults.flatMap((fp) =>
        fp.lines.map((l) => [fp.relativePath || fp.docName, fp.pageNumber, l.lineNo, ...l.cells])
      ),
    ];
  }

  // full-table or hybrid
  const firstTable = fullPageResults.find((fp) => fp.tables.length > 0)?.tables[0];
  if (firstTable) {
    return [
      ['ไฟล์', 'หน้า', ...firstTable.headers],
      ...fullPageResults.flatMap((fp) =>
        fp.tables.flatMap((t) =>
          t.rows.map((row) => [fp.relativePath || fp.docName, fp.pageNumber, ...row])
        )
      ),
    ];
  }

  return [
    ['ไฟล์', 'หน้า', 'Field', 'Value'],
    ...fullPageResults.flatMap((fp) =>
      fp.keyValues.map((kv) => [fp.relativePath || fp.docName, fp.pageNumber, kv.key, kv.value])
    ),
  ];
}

export function exportResultsToCsv(params: {
  mode: ExtractionMode;
  zones: OcrZone[];
  zoneResults: ZonePageResult[];
  fullPageResults: FullPageResult[];
}): void {
  const matrix = buildFlatMatrix(params);
  const csvBody = matrix
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell ?? '').replace(/"/g, '""');
          return `"${s}"`;
        })
        .join(',')
    )
    .join('\r\n');

  const blob = new Blob(['\uFEFF' + csvBody], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rasterzone_ocr_${params.mode}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

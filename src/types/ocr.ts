export type ExtractionMode = 'zones' | 'full-table' | 'hybrid' | 'full-lines';

export type ZoneDataType = 'text' | 'number' | 'date' | 'table';

export type CoordinateUnit = 'mm' | 'px' | 'percent';

export interface OcrZone {
  id: string;
  label: string;
  dataType: ZoneDataType;
  /** Coordinates stored in normalized 0..1 ratio relative to page image dimensions */
  xRatio: number;
  yRatio: number;
  wRatio: number;
  hRatio: number;
  /** Which pages this zone applies to: 'all' or 1-based page number */
  pageScope: 'all' | number;
}

export interface RenderedPage {
  pageNumber: number;
  widthPx: number;
  heightPx: number;
  widthMm: number;
  heightMm: number;
  /** Original rendered canvas dataURL (PNG/JPEG) */
  dataUrl: string;
}

export interface DocumentItem {
  id: string;
  name: string;
  relativePath: string;
  sourceType: 'pdf' | 'image';
  fileSize: number;
  dpi: number;
  pages: RenderedPage[];
  status: 'ready' | 'processing' | 'done' | 'error';
  errorMessage?: string;
}

export interface ZoneTemplate {
  id: string;
  name: string;
  description: string;
  zones: OcrZone[];
  createdAt: string;
}

export interface ZoneOcrCell {
  zoneId: string;
  label: string;
  value: string;
  confidence: 'high' | 'medium' | 'low';
  cropPreviewUrl?: string;
}

export interface ZonePageResult {
  id: string;
  docId: string;
  docName: string;
  relativePath: string;
  pageNumber: number;
  cells: Record<string, ZoneOcrCell>;
}

export interface ExtractedTable {
  tableName: string;
  headers: string[];
  rows: string[][];
}

export interface FullPageResult {
  id: string;
  docId: string;
  docName: string;
  relativePath: string;
  pageNumber: number;
  mode: 'full-table' | 'full-lines' | 'hybrid';
  documentTitle: string;
  keyValues: Array<{ key: string; value: string }>;
  tables: ExtractedTable[];
  lines: Array<{ lineNo: number; cells: string[] }>;
}

export interface ImagePreprocessOptions {
  dpi: 150 | 200 | 300;
  grayscale: boolean;
  contrastBoost: boolean;
}

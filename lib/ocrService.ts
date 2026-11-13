import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

export interface ZoneInput {
  zoneId: string;
  label: string;
  dataType: string;
  imageBase64: string;
  mimeType?: string;
}

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error(
      "ไม่พบ GEMINI_API_KEY บนเซิร์ฟเวอร์ (กรุณาตั้งค่า Environment Variable ชื่อ GEMINI_API_KEY หรือสลับใช้โหมด 'Offline ในเครื่อง')"
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const isRetryable =
        message.includes("429") ||
        message.includes("503") ||
        message.includes("RESOURCE_EXHAUSTED") ||
        message.includes("UNAVAILABLE");
      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

function stripDataUrlPrefix(base64OrDataUrl: string): { data: string; mimeType: string } {
  const match = base64OrDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  return { mimeType: "image/png", data: base64OrDataUrl };
}

export async function runZonesOcr(
  zones: ZoneInput[],
  languageHint?: string
): Promise<Record<string, { text: string; confidence: "high" | "medium" | "low" }>> {
  const ai = getGeminiClient();
  const batchSize = 10;
  const aggregated: Record<string, { text: string; confidence: "high" | "medium" | "low" }> = {};

  for (let i = 0; i < zones.length; i += batchSize) {
    const chunk = zones.slice(i, i + batchSize);
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      {
        text: [
          "You are a high-precision document OCR engine specialized in Thai and English customs, shipping, tax invoices, and business forms.",
          "Below are cropped raster image regions from a scanned/rendered document.",
          "For EACH region, transcribe the exact text visible inside the image verbatim.",
          "Rules:",
          "- Preserve Thai characters, English letters, numbers, slashes, hyphens, and punctuation exactly as shown.",
          "- If the field type is 'date', preserve the date format cleanly.",
          "- If the field type is 'number', preserve numeric formatting accurately.",
          "- If the field type is 'table', preserve row breaks with newlines and columns separated by ' | '.",
          "- If the crop is blank or contains no readable text, return an empty string ''.",
          "- Do NOT translate, guess missing text, or add commentary.",
          languageHint ? `Document context hint: ${languageHint}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ];

    for (const z of chunk) {
      const parsed = stripDataUrlPrefix(z.imageBase64);
      parts.push({
        text: `\n--- REGION START ---\nzoneId: "${z.zoneId}"\nfieldLabel: "${z.label}"\ndataType: "${z.dataType}"`,
      });
      parts.push({
        inlineData: {
          mimeType: z.mimeType || parsed.mimeType,
          data: parsed.data,
        },
      });
    }

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: { parts },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    zoneId: { type: Type.STRING },
                    text: { type: Type.STRING },
                    confidence: { type: Type.STRING },
                  },
                  required: ["zoneId", "text", "confidence"],
                },
              },
            },
            required: ["items"],
          },
        },
      })
    );

    const raw = (response.text ?? "{}").trim();
    const parsedJson = JSON.parse(raw) as {
      items?: Array<{ zoneId: string; text: string; confidence: string }>;
    };

    for (const item of parsedJson.items ?? []) {
      const conf =
        item.confidence === "low" || item.confidence === "medium" ? item.confidence : "high";
      aggregated[item.zoneId] = {
        text: (item.text ?? "").trim(),
        confidence: conf,
      };
    }
  }

  return aggregated;
}

export async function runFullPageOcr(params: {
  imageBase64: string;
  mimeType?: string;
  mode: "full-table" | "full-lines" | "hybrid-table";
  customHint?: string;
}) {
  const { imageBase64, mimeType, mode, customHint } = params;
  const parsed = stripDataUrlPrefix(imageBase64);
  const ai = getGeminiClient();

  if (mode === "full-lines") {
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mimeType || parsed.mimeType,
                data: parsed.data,
              },
            },
            {
              text: [
                "Perform full-page layout-preserving OCR on this Thai/English document image.",
                "Read EVERY readable line from top to bottom.",
                "Within each horizontal visual row, split distinct columns/boxes separated by wide horizontal spacing or table borders into separate strings in the 'cells' array.",
                "Preserve Thai and English text, numbers, barcodes, and dates verbatim.",
                customHint ? `Additional instruction: ${customHint}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              documentTitle: { type: Type.STRING },
              lines: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    lineNo: { type: Type.INTEGER },
                    cells: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                  required: ["lineNo", "cells"],
                },
              },
            },
            required: ["documentTitle", "lines"],
          },
        },
      })
    );

    const data = JSON.parse((response.text ?? "{}").trim());
    return {
      documentTitle: data.documentTitle || "Document",
      keyValues: [],
      tables: [],
      lines: Array.isArray(data.lines) ? data.lines : [],
    };
  }

  const promptText =
    mode === "hybrid-table"
      ? [
          "Extract the tabular line items from this cropped table region image.",
          "Identify the column headers accurately (in Thai or English as printed) and extract EVERY row cleanly.",
          "Ensure every row in 'rows' has the exact same number of cells as 'headers'. Use '' for empty cells.",
          customHint ? `Additional instruction: ${customHint}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : [
          "Analyze this full Thai/English document image and extract all structured data for Excel export.",
          "1. 'documentTitle': Main title or form name at the top of the document.",
          "2. 'keyValues': All labeled header/summary fields (e.g., Shipper, Invoice No, Date, Vessel, ETD, Port, Tax ID, Totals).",
          "3. 'tables': Every structured table on the page. For each table, provide 'tableName', 'headers' (column titles), and 'rows' (2D array where each row matches headers length).",
          "Preserve all Thai and English characters, numbers, and dates verbatim.",
          customHint ? `Additional instruction: ${customHint}` : "",
        ]
          .filter(Boolean)
          .join("\n");

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || parsed.mimeType,
              data: parsed.data,
            },
          },
          { text: promptText },
        ],
      },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            documentTitle: { type: Type.STRING },
            keyValues: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  key: { type: Type.STRING },
                  value: { type: Type.STRING },
                },
                required: ["key", "value"],
              },
            },
            tables: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  tableName: { type: Type.STRING },
                  headers: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  rows: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                },
                required: ["tableName", "headers", "rows"],
              },
            },
          },
          required: ["documentTitle", "keyValues", "tables"],
        },
      },
    })
  );

  const data = JSON.parse((response.text ?? "{}").trim());
  return {
    documentTitle: data.documentTitle || "Document",
    keyValues: Array.isArray(data.keyValues) ? data.keyValues : [],
    tables: Array.isArray(data.tables) ? data.tables : [],
    lines: [],
  };
}

import Papa from "papaparse";
import { badRequest } from "../errors";

export const SUPPORTED_EXTENSIONS = ["pdf", "docx", "txt", "md", "markdown", "csv"] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

const MIME_BY_EXT: Record<SupportedExtension, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
};

export function extensionOf(fileName: string): SupportedExtension {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw badRequest(`Unsupported file type ".${ext}". Allowed: ${SUPPORTED_EXTENSIONS.join(", ")}`);
  }
  return ext as SupportedExtension;
}

export function mimeFor(ext: SupportedExtension) {
  return MIME_BY_EXT[ext];
}

/** Checks magic bytes so a renamed binary cannot masquerade as an allowed type. */
export function assertContentMatches(ext: SupportedExtension, buf: Buffer) {
  if (ext === "pdf" && buf.subarray(0, 5).toString("latin1") !== "%PDF-")
    throw badRequest("File is not a valid PDF");
  if (ext === "docx" && !(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)) {
    throw badRequest("File is not a valid DOCX document");
  }
  if (["txt", "md", "markdown", "csv"].includes(ext)) {
    const sample = buf.subarray(0, 8192);
    if (sample.includes(0)) throw badRequest("Text file contains binary data");
  }
}

function csvToText(csv: string): string {
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  if (!parsed.meta.fields?.length) return csv;
  return parsed.data
    .slice(0, 20_000)
    .map((row) =>
      parsed.meta
        .fields!.map((f) => `${f}: ${(row[f] ?? "").toString().trim()}`)
        .filter((l) => !l.endsWith(": "))
        .join("\n"),
    )
    .join("\n\n");
}

/** Extracts plain text from an uploaded document. Never executes embedded content. */
export async function extractText(ext: SupportedExtension, buf: Buffer): Promise<string> {
  assertContentMatches(ext, buf);
  switch (ext) {
    case "pdf": {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await pdfText(pdf, { mergePages: false });
      return (Array.isArray(text) ? text : [text]).join("\n\n");
    }
    case "docx": {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: buf });
      return result.value;
    }
    case "csv":
      return csvToText(buf.toString("utf8"));
    default:
      return buf.toString("utf8");
  }
}

/** Minimal, dependency-free HTML to text conversion for imported web pages. */
export function htmlToText(html: string): { title: string | null; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
  const body = html
    .replace(/<(script|style|noscript|template|svg|iframe|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  const decoded = body
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  const text = decoded
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { title: title ? htmlToText(title).text || title : null, text };
}

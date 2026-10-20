/**
 * Splits document text into overlapping chunks along paragraph and sentence boundaries.
 * Targets ~900 characters per chunk with ~150 characters of overlap.
 */
export function chunkText(text: string, target = 900, overlap = 150): string[] {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) return [];
  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= target) pieces.push(p);
    else {
      const sentences = p.split(/(?<=[.!?])\s+/);
      let buf = "";
      for (const s of sentences) {
        if (s.length > target) {
          if (buf) {
            pieces.push(buf);
            buf = "";
          }
          for (let i = 0; i < s.length; i += target) pieces.push(s.slice(i, i + target));
          continue;
        }
        if ((buf + " " + s).trim().length > target) {
          pieces.push(buf.trim());
          buf = s;
        } else buf = (buf + " " + s).trim();
      }
      if (buf) pieces.push(buf);
    }
  }

  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (!current) current = piece;
    else if (current.length + piece.length + 2 <= target) current += "\n\n" + piece;
    else {
      chunks.push(current);
      const tail = current.slice(-overlap);
      const cut = tail.indexOf(" ");
      current = (cut >= 0 ? tail.slice(cut + 1) : tail) + "\n\n" + piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

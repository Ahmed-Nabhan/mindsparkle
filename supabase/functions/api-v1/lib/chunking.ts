export type Chunk = {
  index: number;
  text: string;
};

export type ChunkOptions = {
  /** Max characters per chunk */
  maxChars: number;
  /** Overlap characters between adjacent chunks */
  overlapChars: number;
};

export function chunkText(text: string, opts: ChunkOptions): Chunk[] {
  const maxChars = Math.max(1, Math.floor(opts.maxChars));
  const overlap = Math.max(0, Math.floor(opts.overlapChars));
  if (overlap >= maxChars) throw new Error("overlapChars must be < maxChars");

  const normalized = (text ?? "").replace(/\r\n/g, "\n");
  if (!normalized.trim()) return [];

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + maxChars);
    const slice = normalized.slice(start, end).trim();
    if (slice) chunks.push({ index, text: slice });

    index += 1;
    if (end >= normalized.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

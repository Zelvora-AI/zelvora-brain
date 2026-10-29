import type { Chunk, SourceDocument } from "../types.js";

export type ChunkOptions = {
  size?: number;
  overlap?: number;
};

const DEFAULT_SIZE = 1_200;
const DEFAULT_OVERLAP = 150;

export function chunkText(
  document: SourceDocument,
  options: ChunkOptions = {},
): Chunk[] {
  const settings = normalizeOptions(options);
  return splitText(document.text, settings).map((text, position) =>
    createChunk(document, text, position),
  );
}

export function chunkMarkdown(
  document: SourceDocument,
  options: ChunkOptions = {},
): Chunk[] {
  const settings = normalizeOptions(options);
  const chunks: Chunk[] = [];

  for (const section of markdownSections(document.text)) {
    for (const text of splitText(section.text, settings)) {
      chunks.push(createChunk(document, text, chunks.length, section.heading));
    }
  }

  return chunks;
}

function createChunk(
  document: SourceDocument,
  text: string,
  position: number,
  section?: string,
): Chunk {
  return {
    id: `${document.id}:${position}`,
    documentId: document.id,
    text,
    position,
    ...(document.title ? { title: document.title } : {}),
    ...(section ? { section } : {}),
    ...(document.metadata ? { metadata: { ...document.metadata } } : {}),
  };
}

function splitText(
  input: string,
  settings: Required<ChunkOptions>,
): string[] {
  const text = input.replace(/\r\n?/g, "\n").trim();
  if (!text) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + settings.size, text.length);
    if (end < text.length) {
      const paragraph = text.lastIndexOf("\n\n", end);
      const sentence = text.lastIndexOf(". ", end);
      const word = text.lastIndexOf(" ", end);
      const boundary = Math.max(paragraph, sentence >= 0 ? sentence + 1 : -1, word);
      if (boundary > start + Math.floor(settings.size / 2)) end = boundary;
    }

    const value = text.slice(start, end).trim();
    if (value) chunks.push(value);
    if (end >= text.length) break;
    start = Math.max(end - settings.overlap, start + 1);
  }

  return chunks;
}

function markdownSections(input: string): Array<{ heading?: string; text: string }> {
  const sections: Array<{ heading?: string; text: string }> = [];
  let heading: string | undefined;
  let lines: string[] = [];

  const flush = () => {
    const text = lines.join("\n").trim();
    if (text) sections.push({ ...(heading ? { heading } : {}), text });
    lines = [];
  };

  for (const line of input.replace(/\r\n?/g, "\n").split("\n")) {
    const match = line.match(/^#{1,6}\s+(.+)$/);
    if (match?.[1]) {
      flush();
      heading = match[1].trim();
    } else {
      lines.push(line);
    }
  }
  flush();

  return sections;
}

function normalizeOptions(options: ChunkOptions): Required<ChunkOptions> {
  const size = options.size ?? DEFAULT_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  if (!Number.isInteger(size) || size < 100) {
    throw new Error("Chunk size must be an integer of at least 100 characters");
  }
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= size) {
    throw new Error("Chunk overlap must be an integer from 0 to size - 1");
  }
  return { size, overlap };
}

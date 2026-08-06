export type ContentType = "article" | "video" | "audio" | "image";

export type RagSourceType = "article" | "document" | "audio" | "video" | "image" | "shared-note" | "message";

export type RagProcessingStatus = "pending" | "processing" | "indexed" | "failed";

export interface RagSourceReference {
  contentId: string;
  userId: string;
  sourceType: RagSourceType;
  sourceUrl?: string | null;
  sourceName?: string | null;
  chunkIndex: number;
  qdrantPointId: string;
}

export interface RagChunk {
  id: string;
  text: string;
  tokenCount?: number | null;
  source: RagSourceReference;
}

export interface RagAskRequest {
  query: string;
  userId: string;
  topK?: number;
}

export interface RagCitation {
  contentId: string;
  title?: string | null;
  sourceType: RagSourceType;
  sourceUrl?: string | null;
  chunkIndex: number;
  score?: number;
}

export interface RagAskResponse {
  answer: string;
  citations: RagCitation[];
}

export interface RagReindexRequest {
  force?: boolean;
}

export interface RagReindexResponse {
  message: string;
  scanned: number;
  reindexed: number;
  failed: number;
  skipped: number;
}

export interface RagIndexResponse {
  message: string;
  contentId: string;
  userId: string;
  chunksIndexed: number;
  chunkIds: string[];
  chunks: Array<{
    qdrantPointId: string;
    chunkIndex: number;
    text: string;
    tokenCount?: number | null;
  }>;
}

export interface RagIndexRequest {
  contentId: string;
  userId: string;
  sourceType: RagSourceType;
  sourceUrl?: string | null;
  sourceName?: string | null;
  text?: string | null;
  parser?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface Tag {
  id: string;
  tagName: string;
}

export interface ContentItem {
  id: string;
  title: string;
  body: string;
  type: ContentType;
  mediaUrl?: string | null;
  processingStatus?: RagProcessingStatus;
  indexedAt?: Date | string | null;
  lastIndexedAt?: Date | string | null;
  shareEnabled?: boolean;
  shareHash?: string | null;
  shareExpiresAt?: Date | string | null;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
  tags?: Tag[];
}

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
}

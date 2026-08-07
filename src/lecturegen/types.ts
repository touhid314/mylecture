export type LectureGenJobStatus =
  | "queued"
  | "generating"
  | "source_ready"
  | "failed";

export type LectureGenUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number | null;
};

export type LectureGenCreateRequest = {
  prompt: string;
  model?: string;
  targetSeconds?: number;
  /** Preferred over targetSeconds when both are set (e.g. "90s", "2:30"). */
  generationLength?: string;
  scriptModel?: string;
  animatorModel?: string;
  enableGetimg?: boolean;
  aspectRatio?: string;
  theme?: string;
  teachingStyle?: string;
  includeVideo?: boolean;
  includeInteractive?: boolean;
  includeGame?: boolean;
  websiteJobId?: string;
  websiteStorageBase?: string;
  meteringOperationId?: string;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    kind: string;
    dataBase64: string;
  }>;
};

export type LectureGenEditRequest = {
  instruction: string;
  meteringOperationId?: string;
  attachments?: LectureGenCreateRequest["attachments"];
};

export type LectureGenTransferPurpose =
  | "source_download"
  | "workspace_download"
  | "resolved_upload"
  | "resolved_download"
  | "resolved_audio_list"
  | "resolved_scene_list";

export type LectureGenCallbackPending = {
  status: "source_ready" | "failed";
  sourceVersion: number;
  usage?: LectureGenUsage | null;
  error?: string;
  interactiveReady?: boolean;
  gameReady?: boolean;
};

export type LectureGenTransferRequest = {
  purpose: LectureGenTransferPurpose;
  sourceVersion: number;
  objectKey?: string;
};

export type LectureGenOwnerRole = "website" | "ide";

export type LectureGenJobRecord = {
  id: string;
  /** Which auth surface created this job; enforces token isolation on read/write. */
  ownerRole: LectureGenOwnerRole;
  status: LectureGenJobStatus;
  sourceVersion: number;
  /** Last source version with persisted artifacts (set on source_ready). */
  lastReadySourceVersion: number;
  logs: string[];
  usage: LectureGenUsage | null;
  error: string | null;
  websiteJobId: string | null;
  websiteStorageBase: string | null;
  createdAt: number;
  updatedAt: number;
  /** Monotonic manifest revision; newer persisted revisions win on conflict. */
  manifestRevision?: number;
  /** Website callback awaiting (re)delivery. */
  callbackPending?: LectureGenCallbackPending | null;
  callbackDeliveredAt?: number | null;
  /** Set when DELETE is requested; reaper may remove artifacts after grace. */
  deleteRequestedAt?: number | null;
  /** Persisted create request snapshot for recovery / activity-only metadata. */
  createRequest?: LectureGenCreateRequest | null;
  lastEditRequest?: LectureGenEditRequest | null;
};

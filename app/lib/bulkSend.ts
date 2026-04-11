export type BulkSendProgressState = {
  active: boolean;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  done: boolean;
  label: string;
};

export type BulkSendChunkResult = {
  sent?: number;
  failed?: number;
  skipped?: number;
};

export type BulkSendChunkContext = {
  batchId: string;
  chunkIndex: number;
  chunkCount: number;
};

type RunChunkedSendOptions<T> = {
  items: T[];
  chunkSize: number;
  label: string;
  onProgress: (state: BulkSendProgressState) => void;
  shouldAbortOnError?: (error: unknown) => boolean;
  sendChunk: (
    chunk: T[],
    context: BulkSendChunkContext,
  ) => Promise<BulkSendChunkResult>;
};

export function getProcessedCount(state: BulkSendProgressState): number {
  return state.sent + state.failed + state.skipped;
}

export async function runChunkedSend<T>({
  items,
  chunkSize,
  label,
  onProgress,
  shouldAbortOnError,
  sendChunk,
}: RunChunkedSendOptions<T>): Promise<BulkSendProgressState> {
  const batchId = globalThis.crypto?.randomUUID?.() ??
    `audit-batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const chunkCount = Math.ceil(items.length / chunkSize);
  let state: BulkSendProgressState = {
    active: true,
    total: items.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    done: false,
    label,
  };

  onProgress(state);

  for (let index = 0; index < items.length; index += chunkSize) {
    const chunk = items.slice(index, index + chunkSize);
    const chunkIndex = index / chunkSize;

    try {
      const result = await sendChunk(chunk, {
        batchId,
        chunkIndex,
        chunkCount,
      });
      state = {
        ...state,
        sent: state.sent + (result.sent ?? 0),
        failed: state.failed + (result.failed ?? 0),
        skipped: state.skipped + (result.skipped ?? 0),
      };
    } catch (error) {
      if (shouldAbortOnError?.(error)) {
        state = {
          ...state,
          active: false,
          done: true,
        };
        onProgress(state);
        throw error;
      }

      state = {
        ...state,
        failed: state.failed + chunk.length,
      };
    }

    onProgress(state);
  }

  state = {
    ...state,
    active: false,
    done: true,
  };

  onProgress(state);
  return state;
}

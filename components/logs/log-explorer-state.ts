import type { LogDetail, LogExplorerSnapshot, LogRecord, LogSearch, LogSearchDraft } from '@/lib/observability/log-search-contract';

export type DetailState =
  | { status: 'idle'; value: null; error: '' }
  | { status: 'loading'; value: null; error: '' }
  | { status: 'ready'; value: LogDetail; error: '' }
  | { status: 'error'; value: null; error: string };

export type ExplorerState = {
  draft: LogSearchDraft;
  applied: LogSearch;
  snapshot: LogExplorerSnapshot | null;
  selectedId: string | null;
  detail: DetailState;
  requestState: 'idle' | 'loading';
  error: string;
};

export type ExplorerAction =
  | { type: 'editDraft'; patch: Partial<LogSearchDraft> }
  | { type: 'applySearch'; search: LogSearch }
  | { type: 'snapshotLoaded'; search: LogSearch; snapshot: LogExplorerSnapshot }
  | { type: 'loadFailed'; error: string }
  | { type: 'selectRow'; id: string }
  | { type: 'detailLoading' }
  | { type: 'detailLoaded'; detail: LogDetail }
  | { type: 'detailFailed'; error: string }
  | { type: 'clearSelection' };

export function createExplorerState(initialSearch: LogSearch, initialSnapshot: LogExplorerSnapshot | null, initialError: string): ExplorerState {
  return {
    draft: { ...initialSearch, cursor: null, filters: { ...initialSearch.filters } },
    applied: initialSnapshot?.applied || initialSearch,
    snapshot: initialSnapshot,
    selectedId: null,
    detail: { status: 'idle', value: null, error: '' },
    requestState: 'idle',
    error: initialError,
  };
}

export function explorerReducer(state: ExplorerState, action: ExplorerAction): ExplorerState {
  switch (action.type) {
    case 'editDraft':
      return { ...state, draft: { ...state.draft, ...action.patch, filters: action.patch.filters ? { ...action.patch.filters } : { ...state.draft.filters } }, error: '' };
    case 'applySearch':
      return {
        ...state,
        applied: action.search,
        snapshot: null,
        selectedId: null,
        detail: { status: 'idle', value: null, error: '' },
        requestState: 'loading',
        error: '',
      };
    case 'snapshotLoaded':
      return { ...state, applied: action.search, draft: { ...action.search, cursor: null, filters: { ...action.search.filters } }, snapshot: action.snapshot, requestState: 'idle', error: '' };
    case 'loadFailed':
      return { ...state, requestState: 'idle', error: action.error };
    case 'selectRow':
      return { ...state, selectedId: action.id, detail: { status: 'loading', value: null, error: '' } };
    case 'detailLoading':
      return { ...state, detail: { status: 'loading', value: null, error: '' } };
    case 'detailLoaded':
      return { ...state, detail: { status: 'ready', value: action.detail, error: '' } };
    case 'detailFailed':
      return { ...state, detail: { status: 'error', value: null, error: action.error } };
    case 'clearSelection':
      return { ...state, selectedId: null, detail: { status: 'idle', value: null, error: '' } };
    default:
      return state;
  }
}

export function selectedRow(state: ExplorerState): LogRecord | null {
  if (!state.selectedId) return null;
  return state.snapshot?.rows.find((row) => row.id === state.selectedId) || null;
}

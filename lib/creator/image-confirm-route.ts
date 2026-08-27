import { NextResponse } from 'next/server';
import { createClient } from '@/lib/local/server';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import {
  assertOwnedResultPath,
  validateCompletedReferencePaths,
  validateStoredImageDraftRequest,
} from '@/lib/creator/image';
import {
  ImageStorageError,
  loadValidatedReferenceContents,
  type CreatorImageStorage,
} from '@/lib/creator/imageStorage';
import {
  confirmCreatorImage,
  CreatorImageConfirmError,
  IMAGE_CONFIRM_PUBLIC_ERRORS,
  type ConfirmImageDependencies,
  type ConfirmImageInput,
  type ConfirmImageResult,
  type ConfirmImageTask,
} from '@/lib/creator/image-service';
import {
  generateWetokenImage,
  providerRequestIdFromImageDiagnostic,
  WetokenImageRequestError,
  WetokenImageResultError,
  type ImageGenerationResult,
} from '@/lib/ai/image';
import { estimateImagePrice, extractReportedCostUsd } from '@/lib/usage/pricing';
import { assertMonthlyBudgetAvailable } from '@/lib/usage/budget';
import {
  buildCreatorImageLedgerEntry,
  recordUsageRequired,
  updateImageUsageStatus,
} from '@/lib/usage/ledger';
import { logCreatorImageEvent, logCreatorImageFailure } from './image-logging';
import { requestTraceId } from '@/lib/observability/server-log';
import type { CreatorImageAsset, CreatorImageTask } from '@/lib/creator/types';

const SIGNED_URL_TTL_SECONDS = 300;
const RESULT_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

type RouteContext = { params: { id: string } };

type ConfirmImageRouteDeps = {
  createClient: () => unknown;
  ensureCreatorWorkspace: (
    store: Parameters<typeof ensureCreatorWorkspace>[0],
    userId: string,
  ) => Promise<{ id: string }>;
  confirmCreatorImage: typeof confirmCreatorImage;
};

function response(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isTimeoutError(error: unknown) {
  return asRecord(error).name === 'TimeoutError' || asRecord(error).name === 'AbortError';
}

function extensionFor(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function hasPrefix(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function matchesMime(bytes: Uint8Array, mimeType: string) {
  if (mimeType === 'image/jpeg') return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === 'image/png') {
    return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  return mimeType === 'image/webp'
    && hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46])
    && hasPrefix(bytes, [0x57, 0x45, 0x42, 0x50], 8);
}

function validateGeneratedImage(generated: ImageGenerationResult) {
  if (!(generated.bytes instanceof Uint8Array) || generated.bytes.byteLength === 0) {
    throw new CreatorImageConfirmError('RESULT_INVALID');
  }
  if (!RESULT_MIME_TYPES.has(generated.mimeType) || !matchesMime(generated.bytes, generated.mimeType)) {
    throw new CreatorImageConfirmError('RESULT_INVALID');
  }
}

function storageAdapter(localClient: ReturnType<typeof createClient>): CreatorImageStorage {
  const bucket = localClient.storage.from('creator-assets');
  return {
    download: (path) => bucket.download(path),
    list: (prefix, options) => bucket.list(prefix, options),
    remove: (paths) => bucket.remove(paths),
  };
}

function serviceError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
  context: { taskId?: string } = {},
) {
  logCreatorImageFailure('http_failed', error, {
    ...context,
    ...(error instanceof WetokenImageResultError && error.diagnostic
      ? { providerDiagnostic: error.diagnostic }
      : {}),
  });
  if (error instanceof CreatorImageConfirmError) {
    const status = error.code === 'GENERATION_TIMEOUT' ? 504
      : error.code === 'RESULT_RECONCILIATION_REQUIRED' ? 503
        : error.code === 'MONTHLY_BUDGET_EXCEEDED' || error.code === 'MONTHLY_BUDGET_PRICE_UNKNOWN'
          ? 402
        : error.code === 'REFERENCES_NOT_READY' || error.code === 'INVALID_DRAFT' || error.code === 'USAGE_RECORD_FAILED'
          ? 409
          : 502;
    return response(error.publicMessage, error.code, status);
  }
  if (isTimeoutError(error)) {
    return response(IMAGE_CONFIRM_PUBLIC_ERRORS.GENERATION_TIMEOUT, 'GENERATION_TIMEOUT', 504);
  }
  if (error instanceof ImageStorageError) {
    return response(IMAGE_CONFIRM_PUBLIC_ERRORS.INVALID_DRAFT, 'INVALID_DRAFT', 409);
  }
  if (error instanceof WetokenImageRequestError) {
    const status = error.status >= 400 && error.status <= 599 ? error.status : 502;
    return response(error.publicMessage, 'WETOKEN_IMAGE_REQUEST_FAILED', status);
  }
  if (error instanceof WetokenImageResultError) {
    return response(error.publicMessage, 'WETOKEN_IMAGE_RESULT_INVALID', 502);
  }
  return response(fallbackMessage, fallbackCode, 500);
}

function isCreatorImageTask(value: unknown): value is ConfirmImageTask {
  const task = asRecord(value);
  return typeof task.id === 'string'
    && typeof task.model === 'string'
    && asRecord(task.request) !== null;
}

function taskNeedsLedgerReconciliation(value: unknown) {
  const output = asRecord(asRecord(value).output);
  return output.requires_reconciliation === true;
}

export async function persistGeneratedImage(
  localClient: ReturnType<typeof createClient>,
  input: {
    task: ConfirmImageTask;
    requestId: string;
    generated: ImageGenerationResult;
    userId: string;
    workspaceId: string;
  },
  options: { updateUsageStatus?: typeof updateImageUsageStatus } = {},
): Promise<ConfirmImageResult> {
  const bucket = localClient.storage.from('creator-assets');
  const updateLedgerStatus = options.updateUsageStatus ?? updateImageUsageStatus;
  const resultPath = `${input.userId}/image-tasks/${input.task.id}/result.${extensionFor(input.generated.mimeType)}`;
  assertOwnedResultPath(resultPath, input.userId, input.task.id);
  const providerRequestId = providerRequestIdFromImageDiagnostic(input.generated.providerDiagnostic);
  const persistenceContext = {
    taskId: input.task.id,
    requestId: input.requestId,
    providerRequestId,
    model: input.task.model,
    mimeType: input.generated.mimeType,
    bytes: input.generated.bytes.byteLength,
  };

  let uploadStarted = false;
  let asset: CreatorImageAsset | null = null;
  let taskUpdated = false;
  let persistenceOutcomeUnknown = false;
  let persistencePhase = 'upload';
  logCreatorImageEvent('result_persistence_started', persistenceContext);
  const cleanup = async () => {
    if (uploadStarted) {
      try {
        await bucket.remove([resultPath]);
      } catch (error) {
        logCreatorImageFailure('result_cleanup_failed', error, persistenceContext);
      }
    }
    if (asset && !taskUpdated) {
      try {
        await localClient
          .from('creator_assets')
          .delete()
          .eq('id', asset.id)
          .eq('workspace_id', input.workspaceId)
          .eq('kind', 'image')
          .eq('source', 'generation')
          .select('id')
          .maybeSingle();
      } catch (error) {
        logCreatorImageFailure('asset_cleanup_failed', error, {
          ...persistenceContext,
          assetId: asset.id,
        });
      }
    }
  };

  try {
    uploadStarted = true;
    const uploaded = await bucket.upload(resultPath, input.generated.bytes, {
      contentType: input.generated.mimeType,
      upsert: false,
    });
    if (uploaded.error) throw new CreatorImageConfirmError('RESULT_PERSIST_FAILED', uploaded.error);
    logCreatorImageEvent('result_uploaded', persistenceContext);

    persistencePhase = 'asset_insert';
    const inserted = await localClient
      .from('creator_assets')
      .insert({
        workspace_id: input.workspaceId,
        session_id: null,
        kind: 'image',
        source: 'generation',
        name: `${input.task.id}.${extensionFor(input.generated.mimeType)}`,
        storage_path: resultPath,
        mime_type: input.generated.mimeType,
        metadata: {
          task_id: input.task.id,
          model: input.task.model,
          prompt: typeof input.task.request.effective_prompt === 'string'
            ? input.task.request.effective_prompt
            : input.task.request.prompt,
          size: input.task.request.size,
          references: Array.isArray(input.task.request.reference_paths)
            ? input.task.request.reference_paths.length : 0,
        },
      })
      .select('*')
      .maybeSingle();
    if (inserted.error || !inserted.data) {
      throw new CreatorImageConfirmError('RESULT_PERSIST_FAILED', inserted.error);
    }
    const candidate = inserted.data as CreatorImageAsset;
    asset = candidate;
    logCreatorImageEvent('asset_inserted', {
      ...persistenceContext,
      assetId: candidate.id,
    });
    if (
      typeof candidate.id !== 'string'
      || candidate.workspace_id !== input.workspaceId
      || candidate.kind !== 'image'
      || candidate.source !== 'generation'
      || candidate.storage_path !== resultPath
    ) {
      throw new CreatorImageConfirmError('RESULT_PERSIST_FAILED');
    }

    persistencePhase = 'task_update';
    const completedAt = new Date().toISOString();
    const output = {
      ...asRecord(input.task.output),
      asset_id: asset.id,
      ...(input.generated.providerDiagnostic
        ? { provider_diagnostic: input.generated.providerDiagnostic }
        : {}),
    };
    let updated: { data: unknown; error: unknown | null };
    try {
      updated = await localClient
        .from('creator_generation_tasks')
        .update({ output, status: 'succeeded', completed_at: completedAt, error: null })
        .eq('id', input.task.id)
        .eq('workspace_id', input.workspaceId)
        .eq('user_id', input.userId)
        .eq('kind', 'image')
        .eq('status', 'submitting')
        .select('*')
        .maybeSingle();
    } catch (error) {
      persistenceOutcomeUnknown = true;
      throw new CreatorImageConfirmError('RESULT_RECONCILIATION_REQUIRED', error);
    }
    if (updated.error || !updated.data) {
      persistenceOutcomeUnknown = true;
      throw new CreatorImageConfirmError('RESULT_RECONCILIATION_REQUIRED', updated.error);
    }
    taskUpdated = true;
    let persistedTask: unknown = updated.data;
    logCreatorImageEvent('task_succeeded', persistenceContext);

    persistencePhase = 'ledger_update';
    let ledgerStatusUpdated = false;
    let ledgerStatus: 'succeeded' | 'unknown' = 'succeeded';
    try {
      ledgerStatusUpdated = await updateLedgerStatus({
        requestId: input.requestId,
        providerRequestId,
        status: 'succeeded',
        completedAt,
        reportedCostUsd: extractReportedCostUsd(input.generated.usage),
      });
      if (!ledgerStatusUpdated) {
        ledgerStatus = 'unknown';
        logCreatorImageEvent('ledger_settlement_unknown', {
          ...persistenceContext,
          status: 'succeeded',
          possiblyCharged: true,
        }, 'warn');
      }
    } catch (error) {
      ledgerStatus = 'unknown';
      logCreatorImageFailure('ledger_settlement_failed', error, {
        ...persistenceContext,
        status: 'succeeded',
        possiblyCharged: true,
      });
    }
    if (ledgerStatusUpdated) {
      logCreatorImageEvent('ledger_settled', {
        ...persistenceContext,
        status: 'succeeded',
        possiblyCharged: true,
      });
    }

    if (ledgerStatus === 'unknown') {
      try {
        const currentOutput = asRecord(asRecord(persistedTask).output);
        const marked = await localClient
          .from('creator_generation_tasks')
          .update({
            output: {
              ...currentOutput,
              ledger_status: 'unknown',
              requires_reconciliation: true,
            },
          })
          .eq('id', input.task.id)
          .eq('workspace_id', input.workspaceId)
          .eq('user_id', input.userId)
          .eq('kind', 'image')
          .eq('status', 'succeeded')
          .select('*')
          .maybeSingle();
        if (marked.error || !marked.data) {
          logCreatorImageFailure('ledger_reconciliation_marker_failed', marked.error, persistenceContext);
        } else {
          persistedTask = marked.data;
          logCreatorImageEvent('ledger_reconciliation_marked', persistenceContext, 'warn');
        }
      } catch (error) {
        logCreatorImageFailure('ledger_reconciliation_marker_failed', error, persistenceContext);
      }
    }

    persistencePhase = 'signed_url';
    let resultUrl: string | null = null;
    try {
      const signed = await bucket.createSignedUrl(resultPath, SIGNED_URL_TTL_SECONDS);
      if (!signed.error) resultUrl = signed.data?.signedUrl || null;
    } catch (error) {
      logCreatorImageFailure('result_signed_url_failed', error, persistenceContext);
    }
    logCreatorImageEvent('result_persistence_completed', {
      ...persistenceContext,
      resultUrlPresent: Boolean(resultUrl),
      ledgerStatus,
      requiresReconciliation: ledgerStatus === 'unknown',
    });
    return {
      task: persistedTask,
      asset,
      assetId: asset.id,
      resultUrl,
      ledgerStatusUpdated,
      ledgerStatus,
      requiresReconciliation: ledgerStatus === 'unknown',
    };
  } catch (error) {
    logCreatorImageFailure('result_persistence_failed', error, {
      ...persistenceContext,
      phase: persistencePhase,
      assetId: asset?.id,
      outcomeUnknown: persistenceOutcomeUnknown,
    });
    if (persistenceOutcomeUnknown) {
      logCreatorImageEvent('result_reconciliation_required', {
        taskId: input.task.id,
        requestId: input.requestId,
        assetId: asset?.id,
        phase: persistencePhase,
      }, 'warn');
    } else {
      await cleanup();
    }
    throw error;
  }
}

function productionDependencies(
  localClient: ReturnType<typeof createClient>,
  userId: string,
  workspaceId: string,
): ConfirmImageDependencies {
  const storage = storageAdapter(localClient);
  return {
    claimDraft: async (input) => {
      const claimed = await localClient
        .from('creator_generation_tasks')
        .update({ status: 'submitting', confirmed_at: new Date().toISOString(), error: null })
        .eq('id', input.taskId)
        .eq('workspace_id', input.workspaceId)
        .eq('user_id', input.userId)
        .eq('kind', 'image')
        .eq('status', 'draft')
        .select('*')
        .maybeSingle();
      if (claimed.error) throw claimed.error;
      return claimed.data as ConfirmImageTask | null;
    },
    preflight: async ({ task, input }) => {
      if (task.request.uploads_complete !== true) {
        throw new CreatorImageConfirmError('REFERENCES_NOT_READY');
      }
      let validated: ReturnType<typeof validateStoredImageDraftRequest>;
      try {
        validated = validateStoredImageDraftRequest(task.model, task.request);
      } catch (error) {
        throw new CreatorImageConfirmError('INVALID_DRAFT', error);
      }
      let paths: string[];
      try {
        paths = validateCompletedReferencePaths(
          task.request.reference_paths,
          validated.references,
          input.userId,
          input.taskId,
        );
      } catch (error) {
        throw new CreatorImageConfirmError('INVALID_DRAFT', error);
      }
      const references = await loadValidatedReferenceContents(storage, paths, validated.references);
      return {
        request: {
          effectivePrompt: validated.effectivePrompt,
          size: validated.size,
          references: validated.references,
          referencePaths: paths,
        },
        references,
      };
    },
    loadReferences: async () => [],
recordAttempt: async ({ requestId, task }) => {
      const resolution = typeof task.request.size === 'string' ? task.request.size : '';
      const pricing = estimateImagePrice(task.model, resolution);
      const budget = await assertMonthlyBudgetAvailable({
        userId,
        estimatedCostUsd: pricing?.estimatedCostUsd,
      });
      if (!budget.allowed) throw new CreatorImageConfirmError(budget.code as keyof typeof IMAGE_CONFIRM_PUBLIC_ERRORS);
      await recordUsageRequired(buildCreatorImageLedgerEntry({
        requestId,
        userId,
        workspaceId,
        creatorTaskId: task.id,
        model: task.model,
        resolution,
        pricing,
      }));
    },
    generate: generateWetokenImage,
    validateGenerated: validateGeneratedImage,
    persistSuccess: ({ task, requestId, generated }) => (
      persistGeneratedImage(
        localClient,
        { task, requestId, generated, userId, workspaceId },
      )
    ),
    settleFailure: async ({ task, requestId, status, error, details }) => {
      const failureUpdate: Record<string, unknown> = {
        status,
        error,
        completed_at: null,
      };
      if (details) {
        failureUpdate.output = {
          ...asRecord(task.output),
          failure_diagnostic: details,
        };
      }
      if (status === 'draft') failureUpdate.confirmed_at = null;
      const updated = await localClient
        .from('creator_generation_tasks')
        .update(failureUpdate)
        .eq('id', task.id)
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .eq('kind', 'image')
        .eq('status', 'submitting')
        .select('id')
        .maybeSingle();
      if (updated.error || !updated.data) {
        throw updated.error || new Error('creator image task failure state was not written');
      }
      if (requestId && status !== 'draft') {
        const providerRequestId = providerRequestIdFromImageDiagnostic(asRecord(details).provider_result);
        try {
          const ledgerUpdated = await updateImageUsageStatus({ requestId, providerRequestId, status });
          if (!ledgerUpdated) {
            logCreatorImageEvent('ledger_failure_settlement_unknown', {
              taskId: task.id,
              requestId,
              providerRequestId,
              status,
              possiblyCharged: status === 'unknown',
            }, 'warn');
          } else {
            logCreatorImageEvent('ledger_failure_settled', {
              taskId: task.id,
              requestId,
              providerRequestId,
              status,
              possiblyCharged: status === 'unknown',
            });
          }
        } catch (ledgerError) {
          logCreatorImageFailure('ledger_failure_settlement_failed', ledgerError, {
            taskId: task.id,
            requestId,
            providerRequestId,
            status,
            possiblyCharged: status === 'unknown',
          });
        }
      }
    },
  };
}

export function createImageConfirmHandlers(deps: ConfirmImageRouteDeps) {
  async function creatorContext() {
    const localClient = deps.createClient() as ReturnType<typeof createClient>;
    const { data: { user } } = await localClient.auth.getUser();
    if (!user) return null;
    const workspace = await deps.ensureCreatorWorkspace({
      rpc: async () => localClient.rpc('ensure_creator_workspace'),
      load: async (id) => localClient.from('creator_workspaces').select('*').eq('id', id).single(),
    }, user.id);
    return { localClient, user, workspace };
  }

  async function findOwnedTask(
    context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>,
    taskId: string,
  ) {
    return context.localClient
      .from('creator_generation_tasks')
      .select('*')
      .eq('id', taskId)
      .eq('workspace_id', context.workspace.id)
      .eq('user_id', context.user.id)
      .eq('kind', 'image')
      .maybeSingle();
  }

  async function POST(req: Request, { params }: RouteContext) {
    const traceId = requestTraceId(req);
    logCreatorImageEvent('http_received', { taskId: params.id, traceId });
    try {
      const context = await creatorContext();
      if (!context) {
        logCreatorImageEvent('http_rejected', {
          taskId: params.id,
          status: 401,
          code: 'UNAUTHENTICATED',
        }, 'warn');
        return response('\u8bf7\u5148\u767b\u5f55', 'UNAUTHENTICATED', 401);
      }
      const input: ConfirmImageInput = {
        taskId: params.id,
        userId: context.user.id,
        workspaceId: context.workspace.id,
        traceId,
      };
      const result = await deps.confirmCreatorImage(
        input,
        productionDependencies(context.localClient, context.user.id, context.workspace.id),
      );
      if (result.duplicate) {
        logCreatorImageEvent('http_duplicate', { taskId: params.id }, 'warn');
        const currentTask = result.task;
        if (currentTask && taskNeedsLedgerReconciliation(currentTask)) {
          return NextResponse.json({
            error: IMAGE_CONFIRM_PUBLIC_ERRORS.LEDGER_RECONCILIATION_REQUIRED,
            code: 'LEDGER_RECONCILIATION_REQUIRED',
            task: currentTask,
            ledgerStatus: 'unknown',
            requiresReconciliation: true,
          }, { status: 503 });
        }
        if (currentTask) return NextResponse.json({ duplicate: true, task: currentTask });
        const current = await findOwnedTask(context, params.id);
        if (current.error) throw current.error;
        if (!current.data) return response('\u56fe\u7247\u4efb\u52a1\u4e0d\u5b58\u5728', 'IMAGE_TASK_NOT_FOUND', 404);
        if (taskNeedsLedgerReconciliation(current.data)) {
          return NextResponse.json({
            error: IMAGE_CONFIRM_PUBLIC_ERRORS.LEDGER_RECONCILIATION_REQUIRED,
            code: 'LEDGER_RECONCILIATION_REQUIRED',
            task: current.data,
            ledgerStatus: 'unknown',
            requiresReconciliation: true,
          }, { status: 503 });
        }
        return NextResponse.json({ duplicate: true, task: current.data });
      }
      if (result.requiresReconciliation) {
        logCreatorImageEvent('http_reconciliation_required', {
          taskId: params.id,
          ledgerStatus: result.ledgerStatus,
        }, 'warn');
        return NextResponse.json({
          error: IMAGE_CONFIRM_PUBLIC_ERRORS.LEDGER_RECONCILIATION_REQUIRED,
          code: 'LEDGER_RECONCILIATION_REQUIRED',
          task: result.task,
          asset: result.asset,
          resultUrl: result.resultUrl ?? null,
          ledgerStatus: 'unknown',
          requiresReconciliation: true,
        }, { status: 503 });
      }
      logCreatorImageEvent('http_completed', {
        taskId: params.id,
        status: 200,
        assetId: typeof result.assetId === 'string' ? result.assetId : undefined,
      });
      return NextResponse.json({
        task: result.task,
        asset: result.asset,
        resultUrl: result.resultUrl ?? null,
      });
    } catch (error: unknown) {
      return serviceError(
        error,
        'IMAGE_CONFIRM_FAILED',
        '\u56fe\u7247\u786e\u8ba4\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
        { taskId: params.id },
      );
    }
  }

  return { POST };
}


export const createConfirmImageHandlers = createImageConfirmHandlers;
export const createCreatorImageConfirmHandlers = createImageConfirmHandlers;

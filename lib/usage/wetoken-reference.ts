/**
 * WeToken's fee CSV can only be reconciled with an exact provider Reference
 * ID. Keep extraction in one small, dependency-free module so the generation
 * and reconciliation paths cannot drift apart.
 */
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function reference(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 512 ? normalized : null;
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function valuesFor(value: Record<string, unknown>, keys: string[]) {
  return keys.map((key) => reference(value[key]));
}

/** Return every known exact Reference ID representation from a safe response diagnostic. */
export function wetokenReferenceIdsFromProviderDiagnostic(diagnostic: unknown) {
  const value = record(diagnostic);
  return unique(valuesFor(value, [
    'referenceId',
    'reference_id',
    'providerRequestId',
    'provider_request_id',
    'providerResponseId',
    'provider_response_id',
    'requestId',
    'request_id',
  ]));
}

/**
 * Read only persisted provider identifiers. This deliberately does not use
 * model, time, amount, or task title: a fee line must still match exactly.
 */
export function wetokenReferenceIdsFromPersistedTask(task: unknown) {
  const value = record(task);
  const output = record(value.output);
  return unique([
    ...valuesFor(value, ['external_task_id', 'externalTaskId']),
    ...valuesFor(output, [
      'wetoken_reference_id',
      'wetokenReferenceId',
      'provider_request_id',
      'providerRequestId',
    ]),
    ...wetokenReferenceIdsFromProviderDiagnostic(output.provider_diagnostic),
    ...wetokenReferenceIdsFromProviderDiagnostic(output.providerDiagnostic),
  ]);
}

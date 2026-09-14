const MAX_AUTOMATIC_PLAYBACK_RECOVERY_ATTEMPTS = 2;

export function nextVideoPlaybackRecoveryAttempt(
  previousAttempt: number | undefined,
  options: { manual?: boolean } = {},
) {
  const completedAttempts = Number.isInteger(previousAttempt) && (previousAttempt || 0) > 0
    ? Number(previousAttempt)
    : 0;
  if (!options.manual && completedAttempts >= MAX_AUTOMATIC_PLAYBACK_RECOVERY_ATTEMPTS) return null;
  return completedAttempts + 1;
}

import type { AgentCanvasChatTurnV2 } from "../../../types-v2.ts";
import { canRetryFailureInScope, turnActionableFailure } from "./actionableFailure.ts";
import { fgLabel } from "../../../fg-scope.ts";

export function FailedTurnBubble({
  turn,
  retrying,
  onRetry,
}: {
  turn: AgentCanvasChatTurnV2;
  retrying: boolean;
  onRetry: () => void;
}) {
  const detail = turn.error_message?.trim()
    || turn.operation_failure?.message.trim()
    || "The Agent could not complete this response.";
  const canRetry = canRetryFailureInScope(turnActionableFailure(turn), "turn");

  return (
    <section
      className="agent-chat__failed-turn"
      role="alert"
      aria-label="Agent response failed"
    >
      <strong>{fgLabel("Agent response failed")}</strong>
      <p>{fgLabel(detail)}</p>
      {canRetry ? (
        <button
          type="button"
          aria-label={fgLabel("Retry failed Agent response")}
          disabled={retrying}
          onClick={onRetry}
        >
          {fgLabel(retrying ? "Retrying…" : "Retry")}
        </button>
      ) : null}
    </section>
  );
}

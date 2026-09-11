import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_BOARD_DAEMON_URL } from "@t3tools/contracts/settings";

import type {
  BoardApp,
  BoardCard,
  BoardStage,
  BoardStageEnteredBy,
  BoardStageId,
  BoardThread,
} from "./boardTypes";

/** Thread statuses the daemon reports while work is still moving. */
const ACTIVE_THREAD_STATUSES = new Set(["preparing", "queued", "starting", "running", "waiting"]);

/**
 * Stages only the daemon may enter, because they are facts about a thread
 * rather than a decision. Dropping onto one is always refused; the board
 * previews that in red before the drop so the refusal is not a surprise.
 */
export const DAEMON_ONLY_STAGES: ReadonlySet<BoardStageId> = new Set(["implementing", "review"]);

/** `http://host:4131/` and `http://host:4131` address the same daemon. */
export function normalizeBoardDaemonUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.length === 0 ? DEFAULT_BOARD_DAEMON_URL : trimmed;
}

export function boardApiUrl(base: string, path: string, query?: Record<string, string>): string {
  const url = new URL(path, `${normalizeBoardDaemonUrl(base)}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function boardSocketUrl(base: string, query?: Record<string, string>): string {
  const url = new URL(boardApiUrl(base, "ws", query));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/**
 * The thread whose state the card should show: the newest implementation or
 * test thread, else the newest linked thread at all.
 */
export function newestBoardThread(card: BoardCard): BoardThread | null {
  const work = card.threads.filter(
    (thread) => thread.role === "implement" || thread.role === "test",
  );
  return work.at(-1) ?? card.threads.at(-1) ?? null;
}

export type BoardChipTone = "running" | "waiting" | "done" | "failed";

export type BoardStatusChip = { readonly tone: BoardChipTone; readonly label: string };

/**
 * One chip summarising what the card's thread is doing. A pending request
 * outranks everything — it is the only state that needs the user — then live
 * work, then the terminal outcome, preferring a pull request number over the
 * raw status because that is what a finished card is judged on.
 */
export function resolveBoardStatusChip(card: BoardCard): BoardStatusChip | null {
  const state = newestBoardThread(card)?.state;
  if (!state) return null;

  if (state.pendingRequest) {
    return {
      tone: "waiting",
      label: state.pendingRequest === "approval" ? "needs approval" : "needs input",
    };
  }
  if (ACTIVE_THREAD_STATUSES.has(state.status)) {
    return { tone: "running", label: state.branch ? `running · ${state.branch}` : "running" };
  }

  const tone: BoardChipTone = /fail|error|cancel|abort/i.test(state.status) ? "failed" : "done";
  const pullRequest = state.pullRequests.at(-1);
  return { tone, label: pullRequest ? `PR #${pullRequest.number}` : state.status };
}

export type BoardDropPreview = "none" | "allowed" | "refused";

/**
 * What a column should show while a card hovers over it. Dropping a card back
 * onto its own stage is a no-op rather than a move, so it gets no preview.
 */
export function resolveBoardDropPreview(input: {
  readonly stageId: BoardStageId;
  readonly draggedCardStage: BoardStageId | null;
}): BoardDropPreview {
  if (input.draggedCardStage === null) return "none";
  if (input.draggedCardStage === input.stageId) return "none";
  return DAEMON_ONLY_STAGES.has(input.stageId) ? "refused" : "allowed";
}

/** Stages a card may be moved into by hand, for the drawer's "Move to…". */
export function selectableBoardStages(
  stages: ReadonlyArray<BoardStage>,
  currentStage: BoardStageId,
): ReadonlyArray<BoardStage> {
  return stages.filter((stage) => !DAEMON_ONLY_STAGES.has(stage.id) && stage.id !== currentStage);
}

export function visibleBoardStages(
  stages: ReadonlyArray<BoardStage>,
  showDropped: boolean,
): ReadonlyArray<BoardStage> {
  return stages.filter((stage) => !stage.hidden || showDropped);
}

/**
 * The in-app thread route a click on the card should open. The daemon records
 * the environment's own id (the UUID from `/.well-known/t3/environment`),
 * which is exactly the `$environmentId` route param, so the board never has to
 * fall back to the `t3code://` deep link the standalone page used.
 */
export function resolveBoardThreadRoute(
  card: BoardCard,
  apps: ReadonlyArray<BoardApp>,
): { readonly environmentId: EnvironmentId; readonly threadId: ThreadId } | null {
  const environmentId = apps.find((app) => app.id === card.appId)?.environmentId;
  if (!environmentId || !card.primaryThreadId) return null;
  return {
    environmentId: environmentId as EnvironmentId,
    threadId: card.primaryThreadId as ThreadId,
  };
}

/** Column accent: who is allowed to put a card here. */
export function boardStageAccentClassName(enteredBy: BoardStageEnteredBy): string {
  switch (enteredBy) {
    case "user":
      return "bg-warning";
    case "manager":
      return "bg-info";
    case "daemon":
      return "bg-muted-foreground/50";
    case "both":
      return "bg-linear-to-r from-warning from-50% to-info to-50%";
  }
}

export const BOARD_STAGE_ACCENT_LABEL: Record<BoardStageEnteredBy, string> = {
  user: "You",
  manager: "Manager",
  daemon: "Daemon",
  both: "You or manager",
};

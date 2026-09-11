/**
 * Wire shapes of the t3kan daemon's board API (`GET /api/state`, `GET
 * /api/cards/:id`, the `/ws` pushes). The daemon is a separate process that
 * owns the cards, so these are its types mirrored by hand rather than a shared
 * contract; the view treats anything it does not recognise as absent.
 */

export type BoardStageId = string;

export type BoardStageEnteredBy = "user" | "manager" | "daemon" | "both";

export type BoardStage = {
  readonly id: BoardStageId;
  readonly label: string;
  readonly enteredBy: BoardStageEnteredBy;
  readonly collapsed: boolean;
  readonly hidden: boolean;
};

export type BoardApp = {
  readonly id: string;
  readonly name: string;
  readonly projectId: string | null;
  readonly managerThreadId: string | null;
  readonly webBaseUrl: string | null;
  readonly environmentId: string | null;
};

export type BoardPullRequest = {
  readonly number: number;
  readonly url: string;
  readonly state: string;
};

export type BoardThreadState = {
  readonly status: string;
  readonly activeRunId: string | null;
  readonly pendingRequest: string | null;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly pullRequests: ReadonlyArray<BoardPullRequest>;
};

export type BoardThread = {
  readonly threadId: string;
  readonly role: string;
  readonly linkedAt: string;
  readonly state: BoardThreadState | null;
};

export type BoardCard = {
  readonly id: number;
  readonly appId: string;
  readonly title: string;
  readonly type: string;
  readonly stage: BoardStageId;
  readonly bodyMd: string;
  readonly planMd: string | null;
  readonly stageChangedBy: string;
  readonly stageChangedAt: string;
  readonly threads: ReadonlyArray<BoardThread>;
  readonly primaryThreadId: string | null;
  readonly primaryIsManager: boolean;
};

export type BoardState = {
  readonly apps: ReadonlyArray<BoardApp>;
  readonly cards: ReadonlyArray<BoardCard>;
  readonly stages: ReadonlyArray<BoardStage>;
};

export type BoardCardEvent = {
  readonly fromStage: BoardStageId | null;
  readonly toStage: BoardStageId;
  readonly actor: string;
  readonly note: string | null;
  readonly at: string;
};

export type BoardCardDetail = {
  readonly card: BoardCard;
  readonly events: ReadonlyArray<BoardCardEvent>;
};

/** Outcome of `POST /api/cards/:id/move`; a refusal is a 200 with `ok: false`. */
export type BoardMoveResult =
  | { readonly ok: true; readonly from: BoardStageId; readonly to: BoardStageId }
  | { readonly ok: false; readonly reason: string };

/**
 * A T3 project the daemon can see, from `GET /api/t3/projects`. `appId` is the
 * t3kan app already registered for it, so the picker can say which projects are
 * spoken for without a second lookup.
 */
export type BoardT3Project = {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly appId: string | null;
};

/** Outcome of `POST /api/apps`; a refusal is a 200 with `ok: false`. */
export type BoardCreateAppResult =
  | { readonly ok: true; readonly app: BoardApp }
  | { readonly ok: false; readonly reason: string };

/** Outcome of `POST /api/apps/:id/manager`, which launches a fresh manager thread. */
export type BoardManagerSessionResult =
  | {
      readonly ok: true;
      readonly threadId: string;
      readonly environmentId: string;
      readonly app: BoardApp;
    }
  | { readonly ok: false; readonly reason: string };

export const EMPTY_BOARD_STATE: BoardState = { apps: [], cards: [], stages: [] };

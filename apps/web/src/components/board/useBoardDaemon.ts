import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { boardApiUrl, boardSocketUrl, type BoardCreateAppInput } from "./boardLogic";
import {
  EMPTY_BOARD_STATE,
  type BoardApp,
  type BoardCardDetail,
  type BoardCreateAppResult,
  type BoardManagerSessionResult,
  type BoardMoveResult,
  type BoardState,
  type BoardT3Project,
} from "./boardTypes";

export type BoardConnectionPhase = "connecting" | "live" | "offline";

const MAX_RECONNECT_DELAY_MS = 15_000;
const MOVE_HIGHLIGHT_MS = 1_600;

function reconnectDelayMs(attempt: number): number {
  return Math.min(500 * 2 ** Math.max(attempt - 1, 0), MAX_RECONNECT_DELAY_MS);
}

function daemonQuery(appId: string | null, showDropped: boolean): Record<string, string> {
  return {
    ...(appId === null ? {} : { app: appId }),
    ...(showDropped ? { dropped: "1" } : {}),
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function errorMessage(body: Record<string, unknown>, response: Response): string {
  return typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
}

export type BoardDaemon = {
  readonly state: BoardState;
  readonly phase: BoardConnectionPhase;
  /** Why the last load failed, while the daemon stays unreachable. */
  readonly unreachableReason: string | null;
  /** Cards whose stage changed within the last moment, for a settling highlight. */
  readonly recentlyMovedCardIds: ReadonlySet<number>;
  readonly refresh: () => void;
  readonly moveCard: (cardId: number, to: string) => Promise<BoardMoveResult>;
  readonly createCard: (input: {
    appId: string;
    title: string;
    type: string;
    stage: string;
  }) => Promise<number>;
  readonly loadCard: (cardId: number) => Promise<BoardCardDetail>;
  /** Every T3 project the daemon can see, for the "Add app" picker. */
  readonly loadT3Projects: () => Promise<ReadonlyArray<BoardT3Project>>;
  readonly createApp: (input: BoardCreateAppInput) => Promise<BoardCreateAppResult>;
  /** Launches a fresh manager thread for the app, settling the previous one. */
  readonly createManagerSession: (appId: string) => Promise<BoardManagerSessionResult>;
};

/**
 * Live mirror of the t3kan daemon's board. The daemon pushes the whole board
 * on connect and after every change, so the socket is the source of truth and
 * the initial fetch exists only to render (and to name the failure) before the
 * socket settles.
 */
export function useBoardDaemon(input: {
  readonly baseUrl: string;
  readonly appId: string | null;
  readonly showDropped: boolean;
}): BoardDaemon {
  const { baseUrl, appId, showDropped } = input;
  const [state, setState] = useState<BoardState>(EMPTY_BOARD_STATE);
  const [phase, setPhase] = useState<BoardConnectionPhase>("connecting");
  const [unreachableReason, setUnreachableReason] = useState<string | null>(null);
  const [recentlyMovedCardIds, setRecentlyMovedCardIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [retryCount, setRetryCount] = useState(0);
  const highlightTimeouts = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  /**
   * Which board view the socket should be holding. `attempt` carries no data;
   * bumping it is how a manual retry tears the old socket down and dials again.
   */
  const target = useMemo(
    () => ({ baseUrl, query: daemonQuery(appId, showDropped), attempt: retryCount }),
    [appId, baseUrl, retryCount, showDropped],
  );

  const highlightMove = useCallback((cardId: number) => {
    const timeouts = highlightTimeouts.current;
    clearTimeout(timeouts.get(cardId));
    setRecentlyMovedCardIds((current) => new Set(current).add(cardId));
    timeouts.set(
      cardId,
      setTimeout(() => {
        timeouts.delete(cardId);
        setRecentlyMovedCardIds((current) => {
          const next = new Set(current);
          next.delete(cardId);
          return next;
        });
      }, MOVE_HIGHLIGHT_MS),
    );
  }, []);

  useEffect(() => {
    const timeouts = highlightTimeouts.current;
    return () => {
      for (const timeout of timeouts.values()) clearTimeout(timeout);
      timeouts.clear();
    };
  }, []);

  // Highlighting is a reaction to a socket frame, not a reason to reopen the
  // socket, so it stays out of the connection effect's dependencies.
  const onCardMoved = useEffectEvent((cardId: number) => highlightMove(cardId));

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const load = async () => {
      try {
        const response = await fetch(boardApiUrl(target.baseUrl, "api/state", target.query));
        if (disposed) return;
        if (!response.ok) {
          setUnreachableReason(errorMessage(await readJson(response), response));
          return;
        }
        setState((await response.json()) as BoardState);
        setUnreachableReason(null);
      } catch (error) {
        if (disposed) return;
        setUnreachableReason(error instanceof Error ? error.message : String(error));
      }
    };

    const connect = () => {
      if (disposed) return;
      setPhase("connecting");
      socket = new WebSocket(boardSocketUrl(target.baseUrl, target.query));
      socket.addEventListener("open", () => {
        attempt = 0;
        setPhase("live");
        setUnreachableReason(null);
      });
      socket.addEventListener("message", (event) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(String(event.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        if (message.kind === "state") {
          const { apps, cards, stages } = message as unknown as BoardState;
          setState({ apps, cards, stages });
        } else if (message.kind === "moved" && typeof message.cardId === "number") {
          onCardMoved(message.cardId);
        }
      });
      socket.addEventListener("close", () => {
        if (disposed) return;
        setPhase("offline");
        attempt += 1;
        reconnectTimeout = setTimeout(connect, reconnectDelayMs(attempt));
      });
      // A socket error is always followed by a close, which owns the retry.
      socket.addEventListener("error", () => socket?.close());
    };

    void load().then(connect);

    return () => {
      disposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      socket?.close();
    };
  }, [target]);

  const refresh = useCallback(() => setRetryCount((count) => count + 1), []);

  const moveCard = useCallback(
    async (cardId: number, to: string): Promise<BoardMoveResult> => {
      const response = await fetch(boardApiUrl(baseUrl, `api/cards/${cardId}/move`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, note: "dragged on board" }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(body, response));
      if (body.ok !== true) {
        return { ok: false, reason: typeof body.reason === "string" ? body.reason : "refused" };
      }
      highlightMove(cardId);
      // The daemon pushes the new board over the socket; patch locally so the
      // card lands in its column on the same frame as the drop.
      setState((current) => ({
        ...current,
        cards: current.cards.map((card) => (card.id === cardId ? { ...card, stage: to } : card)),
      }));
      return { ok: true, from: String(body.from), to: String(body.to) };
    },
    [baseUrl, highlightMove],
  );

  const createCard = useCallback(
    async (cardInput: { appId: string; title: string; type: string; stage: string }) => {
      const response = await fetch(boardApiUrl(baseUrl, "api/cards"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cardInput),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(body, response));
      const card = body.card as { id: number };
      return card.id;
    },
    [baseUrl],
  );

  const loadCard = useCallback(
    async (cardId: number): Promise<BoardCardDetail> => {
      const response = await fetch(boardApiUrl(baseUrl, `api/cards/${cardId}`));
      const body = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(body, response));
      return body as unknown as BoardCardDetail;
    },
    [baseUrl],
  );

  const loadT3Projects = useCallback(async (): Promise<ReadonlyArray<BoardT3Project>> => {
    const response = await fetch(boardApiUrl(baseUrl, "api/t3/projects"));
    const body = await readJson(response);
    if (!response.ok) throw new Error(errorMessage(body, response));
    return (Array.isArray(body.projects) ? body.projects : []) as ReadonlyArray<BoardT3Project>;
  }, [baseUrl]);

  const createApp = useCallback(
    async (input: BoardCreateAppInput): Promise<BoardCreateAppResult> => {
      const response = await fetch(boardApiUrl(baseUrl, "api/apps"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(body, response));
      if (body.ok !== true) {
        return { ok: false, reason: typeof body.reason === "string" ? body.reason : "refused" };
      }
      return { ok: true, app: body.app as BoardApp };
    },
    [baseUrl],
  );

  const createManagerSession = useCallback(
    async (appId: string): Promise<BoardManagerSessionResult> => {
      const response = await fetch(boardApiUrl(baseUrl, `api/apps/${appId}/manager`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(body, response));
      if (body.ok !== true) {
        return { ok: false, reason: typeof body.reason === "string" ? body.reason : "refused" };
      }
      return {
        ok: true,
        threadId: String(body.threadId),
        environmentId: String(body.environmentId),
        app: body.app as BoardApp,
      };
    },
    [baseUrl],
  );

  return {
    state,
    phase,
    unreachableReason,
    recentlyMovedCardIds,
    refresh,
    moveCard,
    createCard,
    loadCard,
    loadT3Projects,
    createApp,
    createManagerSession,
  };
}

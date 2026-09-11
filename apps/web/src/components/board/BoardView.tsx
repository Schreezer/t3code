import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useMemo, useState, type DragEvent } from "react";

import { isElectron } from "../../env";
import { useClientSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { BoardAddAppDialog } from "./BoardAddAppDialog";
import {
  BOARD_STAGE_ACCENT_LABEL,
  boardStageAccentClassName,
  normalizeBoardDaemonUrl,
  resolveBoardDropPreview,
  resolveBoardManagerRoute,
  resolveBoardStatusChip,
  resolveBoardThreadRoute,
  visibleBoardStages,
  type BoardChipTone,
} from "./boardLogic";
import { BoardCardDrawer } from "./BoardCardDrawer";
import { BoardManagerControl } from "./BoardManagerControl";
import type { BoardApp, BoardCard, BoardStage, BoardStageId } from "./boardTypes";
import { useBoardDaemon, type BoardConnectionPhase } from "./useBoardDaemon";

/**
 * Sentinel value for the app selector's "Add app…" row. App ids are slugs, so
 * no real app can collide with it.
 */
const ADD_APP_VALUE = "__add_app__";

const CARD_TYPES = ["bug", "feature", "tweak", "idea"] as const;
const NEW_CARD_STAGES = ["discussing", "planned", "later"] as const;

const CHIP_VARIANT: Record<BoardChipTone, "info" | "warning" | "success" | "error"> = {
  running: "info",
  waiting: "warning",
  done: "success",
  failed: "error",
};

const CONNECTION_DOT: Record<BoardConnectionPhase, { className: string; label: string }> = {
  connecting: { className: "bg-warning", label: "Connecting to the t3kan daemon" },
  live: { className: "bg-success", label: "Live" },
  offline: { className: "bg-destructive", label: "Offline — retrying" },
};

function ConnectionIndicator({ phase }: { phase: BoardConnectionPhase }) {
  const { className, label } = CONNECTION_DOT[phase];
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", className)} />
      {label}
    </span>
  );
}

function BoardCardTile(props: {
  readonly card: BoardCard;
  readonly highlighted: boolean;
  readonly onOpenThread: () => void;
  readonly onOpenDrawer: () => void;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
}) {
  const { card } = props;
  const chip = resolveBoardStatusChip(card);

  return (
    <article
      draggable
      onDragStart={(event: DragEvent<HTMLElement>) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(card.id));
        props.onDragStart();
      }}
      onDragEnd={props.onDragEnd}
      className={cn(
        "flex cursor-grab flex-col gap-1.5 rounded-lg border bg-card p-2.5 text-left shadow-xs/5",
        props.highlighted && "ring-2 ring-info",
      )}
    >
      <button
        type="button"
        onClick={props.onOpenThread}
        className="cursor-pointer text-left text-[13px] leading-snug font-medium text-foreground outline-hidden hover:text-primary focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
      >
        {card.title}
      </button>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <button
          type="button"
          onClick={props.onOpenDrawer}
          aria-label={`Open details for card ${card.id}`}
          className="cursor-pointer font-mono underline decoration-dotted underline-offset-2 outline-hidden hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
        >
          #{card.id}
        </button>
        <span aria-hidden>·</span>
        <span>{card.type}</span>
        {card.planMd ? (
          <Badge size="sm" variant="secondary">
            plan
          </Badge>
        ) : null}
      </div>
      {chip ? (
        <div className="flex min-w-0">
          <Badge size="sm" variant={CHIP_VARIANT[chip.tone]} className="max-w-full truncate">
            {chip.label}
          </Badge>
        </div>
      ) : null}
    </article>
  );
}

function BoardColumn(props: {
  readonly stage: BoardStage;
  readonly cards: ReadonlyArray<BoardCard>;
  readonly collapsed: boolean;
  readonly preview: "none" | "allowed" | "refused";
  readonly onToggleCollapsed: () => void;
  readonly onDragEnter: () => void;
  readonly onDrop: () => void;
  readonly children: React.ReactNode;
}) {
  const { stage } = props;

  if (props.collapsed) {
    return (
      <button
        type="button"
        onClick={props.onToggleCollapsed}
        className="flex w-11 shrink-0 cursor-pointer flex-col items-center gap-2 rounded-lg border bg-muted/30 py-3 outline-hidden hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className={cn("h-1 w-6 rounded-full", boardStageAccentClassName(stage.enteredBy))}
        />
        <span className="[writing-mode:vertical-rl] text-xs font-medium text-foreground">
          {stage.label}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">{props.cards.length}</span>
      </button>
    );
  }

  return (
    <section
      data-stage={stage.id}
      onDragEnter={props.onDragEnter}
      onDragOver={(event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        props.onDrop();
      }}
      className={cn(
        "flex w-60 shrink-0 flex-col gap-2 rounded-lg border bg-muted/30 p-2",
        props.preview === "allowed" && "border-dashed border-primary bg-accent/40",
        props.preview === "refused" && "border-dashed border-destructive bg-destructive/8",
      )}
    >
      <div className="flex flex-col gap-1.5">
        <span
          aria-hidden
          className={cn("h-1 w-full rounded-full", boardStageAccentClassName(stage.enteredBy))}
        />
        <div className="flex items-baseline justify-between gap-2 px-0.5">
          <button
            type="button"
            onClick={props.onToggleCollapsed}
            className="cursor-pointer text-xs font-medium text-foreground outline-hidden focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
          >
            {stage.label}
          </button>
          <span className="font-mono text-[11px] text-muted-foreground">
            {props.cards.length || ""}
          </span>
        </div>
        <span className="px-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {BOARD_STAGE_ACCENT_LABEL[stage.enteredBy]}
        </span>
      </div>
      <div className="flex min-h-16 flex-1 flex-col gap-2">{props.children}</div>
    </section>
  );
}

function NewCardForm(props: {
  readonly appId: string | null;
  readonly onCreate: (input: { title: string; type: string; stage: string }) => void;
  readonly onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<string>("tweak");
  const [stage, setStage] = useState<string>("discussing");

  return (
    <form
      className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5 sm:px-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim().length === 0) return;
        props.onCreate({ title: title.trim(), type, stage });
        setTitle("");
      }}
    >
      <Input
        autoFocus
        size="sm"
        className="min-w-52 flex-1"
        placeholder="What needs doing?"
        aria-label="New card title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Select value={type} onValueChange={(value) => setType(String(value))}>
        <SelectTrigger size="sm" className="w-32 min-w-0" aria-label="Card type">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {CARD_TYPES.map((cardType) => (
            <SelectItem key={cardType} value={cardType}>
              {cardType}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <Select value={stage} onValueChange={(value) => setStage(String(value))}>
        <SelectTrigger size="sm" className="w-36 min-w-0" aria-label="Starting stage">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {NEW_CARD_STAGES.map((stageId) => (
            <SelectItem key={stageId} value={stageId}>
              {stageId}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <Button size="sm" type="submit" disabled={props.appId === null}>
        Add card
      </Button>
      <Button size="sm" type="button" variant="ghost-muted" onClick={props.onCancel}>
        Cancel
      </Button>
    </form>
  );
}

/**
 * The t3kan kanban board, rendered against the daemon that owns the cards.
 * Clicking a card routes to its thread inside the app; the daemon's own
 * `links.desktop` deep link exists for tools outside T3 Code.
 */
export function BoardView() {
  const navigate = useNavigate();
  const daemonUrl = useClientSettings((settings) =>
    normalizeBoardDaemonUrl(settings.boardDaemonUrl),
  );
  const [appId, setAppId] = useState<string | null>(null);
  const [showDropped, setShowDropped] = useState(false);
  const [expandedStages, setExpandedStages] = useState<ReadonlySet<BoardStageId>>(() => new Set());
  const [draggedCardId, setDraggedCardId] = useState<number | null>(null);
  const [hoveredStage, setHoveredStage] = useState<BoardStageId | null>(null);
  const [newCardOpen, setNewCardOpen] = useState(false);
  const [drawerCardId, setDrawerCardId] = useState<number | null>(null);
  const [addAppOpen, setAddAppOpen] = useState(false);
  const [managerPendingAppId, setManagerPendingAppId] = useState<string | null>(null);

  const board = useBoardDaemon({ baseUrl: daemonUrl, appId, showDropped });
  const { state, moveCard, createCard, createApp, createManagerSession } = board;

  const draggedCard = state.cards.find((card) => card.id === draggedCardId) ?? null;
  const stages = useMemo(
    () => visibleBoardStages(state.stages, showDropped),
    [showDropped, state.stages],
  );
  const effectiveAppId = appId ?? (state.apps.length === 1 ? state.apps[0]!.id : null);
  const selectedApp = state.apps.find((app) => app.id === effectiveAppId) ?? null;

  const performMove = useCallback(
    async (cardId: number, to: BoardStageId) => {
      const stageLabel = state.stages.find((stage) => stage.id === to)?.label ?? to;
      try {
        const result = await moveCard(cardId, to);
        if (!result.ok) {
          toastManager.add(
            stackedThreadToast({
              type: "warning",
              title: `Move refused: #${cardId} → ${stageLabel}`,
              description: result.reason,
            }),
          );
        }
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not move the card",
            description: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },
    [moveCard, state.stages],
  );

  const openCardThread = useCallback(
    (card: BoardCard) => {
      const target = resolveBoardThreadRoute(card, state.apps);
      if (target === null) {
        setDrawerCardId(card.id);
        return;
      }
      void navigate({ to: "/$environmentId/$threadId", params: target });
    },
    [navigate, state.apps],
  );

  const handleCreate = useCallback(
    async (input: { title: string; type: string; stage: string }) => {
      if (effectiveAppId === null) return;
      try {
        const cardId = await createCard({ appId: effectiveAppId, ...input });
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: "Card created",
            description: `#${cardId} ${input.title}`,
          }),
        );
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not create the card",
            description: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },
    [createCard, effectiveAppId],
  );

  const handleCreateApp = useCallback(
    async (input: { projectId: string; name: string }) => {
      try {
        const result = await createApp({
          projectId: input.projectId,
          ...(input.name.length > 0 ? { name: input.name } : {}),
        });
        if (!result.ok) {
          toastManager.add(
            stackedThreadToast({
              type: "warning",
              title: "Could not add the app",
              description: result.reason,
            }),
          );
          return false;
        }
        setAppId(result.app.id);
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: "App added",
            description: `${result.app.name} (${result.app.id})`,
          }),
        );
        return true;
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not add the app",
            description: error instanceof Error ? error.message : String(error),
          }),
        );
        return false;
      }
    },
    [createApp],
  );

  const openManagerThread = useCallback(
    (app: BoardApp) => {
      const target = resolveBoardManagerRoute(app);
      if (target === null) return;
      void navigate({ to: "/$environmentId/$threadId", params: target });
    },
    [navigate],
  );

  /**
   * Launching a manager takes the daemon a few seconds — it settles the old
   * thread and starts a real turn in the project — so the control stays pending
   * until the new thread is ours to open.
   */
  const startManagerSession = useCallback(
    async (app: BoardApp) => {
      setManagerPendingAppId(app.id);
      try {
        const result = await createManagerSession(app.id);
        if (!result.ok) {
          toastManager.add(
            stackedThreadToast({
              type: "warning",
              title: "Could not start the manager",
              description: result.reason,
            }),
          );
          return;
        }
        void navigate({
          to: "/$environmentId/$threadId",
          params: {
            environmentId: result.environmentId as EnvironmentId,
            threadId: result.threadId as ThreadId,
          },
        });
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not start the manager",
            description: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        setManagerPendingAppId(null);
      }
    },
    [createManagerSession, navigate],
  );

  const unreachable = board.phase !== "live" && board.unreachableReason !== null;
  const noApps = !unreachable && state.stages.length > 0 && state.apps.length === 0;

  return (
    <SidebarInset className="isolate h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspacePageHeader electron={isElectron}>
          <div className="flex w-full min-w-0 items-center gap-3">
            <h1 className="shrink-0 text-sm font-medium">Board</h1>
            <Select
              value={appId ?? ""}
              onValueChange={(value) => {
                const next = String(value);
                if (next === ADD_APP_VALUE) {
                  setAddAppOpen(true);
                  return;
                }
                setAppId(next === "" ? null : next);
              }}
            >
              <SelectTrigger size="sm" className="w-40 min-w-0" aria-label="Board app">
                <SelectValue placeholder="All apps">
                  {state.apps.find((app) => app.id === appId)?.name ?? "All apps"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="">All apps</SelectItem>
                {state.apps.map((app) => (
                  <SelectItem key={app.id} value={app.id}>
                    {app.name}
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value={ADD_APP_VALUE}>Add app…</SelectItem>
              </SelectPopup>
            </Select>
            {selectedApp !== null ? (
              <BoardManagerControl
                app={selectedApp}
                pending={managerPendingAppId === selectedApp.id}
                onOpen={() => openManagerThread(selectedApp)}
                onNewSession={() => void startManagerSession(selectedApp)}
              />
            ) : null}
            <div className="ms-auto flex items-center gap-3">
              <Label className="gap-2 text-xs font-normal text-muted-foreground">
                <Switch
                  size="sm"
                  checked={showDropped}
                  onCheckedChange={(checked) => setShowDropped(Boolean(checked))}
                />
                Dropped
              </Label>
              <ConnectionIndicator phase={board.phase} />
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Reconnect to the t3kan daemon"
                onClick={board.refresh}
              >
                <RefreshCwIcon />
              </Button>
              <Button size="xs" variant="outline" onClick={() => setNewCardOpen((open) => !open)}>
                <PlusIcon />
                New card
              </Button>
            </div>
          </div>
        </WorkspacePageHeader>

        {newCardOpen ? (
          <NewCardForm
            appId={effectiveAppId}
            onCreate={(input) => void handleCreate(input)}
            onCancel={() => setNewCardOpen(false)}
          />
        ) : null}

        {unreachable ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No board daemon at {daemonUrl}</EmptyTitle>
              <EmptyDescription>
                Run <code className="font-mono">t3kan serve</code> next to this project, then
                reconnect. Point the board somewhere else in Settings → Integrations → Board.
              </EmptyDescription>
            </EmptyHeader>
            <p className="font-mono text-xs text-muted-foreground">{board.unreachableReason}</p>
            <Button size="sm" variant="outline" onClick={board.refresh}>
              <RefreshCwIcon />
              Try again
            </Button>
          </Empty>
        ) : noApps ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No apps on this board yet</EmptyTitle>
              <EmptyDescription>
                Register a T3 project so the daemon can track its cards and run a manager thread for
                it.
              </EmptyDescription>
            </EmptyHeader>
            <Button size="sm" onClick={() => setAddAppOpen(true)}>
              <PlusIcon />
              Add app
            </Button>
          </Empty>
        ) : (
          <div
            className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-5 pt-4 pb-5 sm:px-6"
            onDragLeave={(event: DragEvent<HTMLDivElement>) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setHoveredStage(null);
              }
            }}
          >
            <div className="flex h-full min-h-0 items-stretch gap-2.5">
              {stages.map((stage) => {
                const cards = state.cards.filter((card) => card.stage === stage.id);
                const collapsed = stage.collapsed && !expandedStages.has(stage.id);
                return (
                  <BoardColumn
                    key={stage.id}
                    stage={stage}
                    cards={cards}
                    collapsed={collapsed}
                    preview={
                      hoveredStage === stage.id
                        ? resolveBoardDropPreview({
                            stageId: stage.id,
                            draggedCardStage: draggedCard?.stage ?? null,
                          })
                        : "none"
                    }
                    onToggleCollapsed={() =>
                      setExpandedStages((current) => {
                        const next = new Set(current);
                        if (next.has(stage.id)) next.delete(stage.id);
                        else next.add(stage.id);
                        return next;
                      })
                    }
                    onDragEnter={() => setHoveredStage(stage.id)}
                    onDrop={() => {
                      setHoveredStage(null);
                      const cardId = draggedCardId;
                      setDraggedCardId(null);
                      if (cardId !== null && draggedCard?.stage !== stage.id) {
                        void performMove(cardId, stage.id);
                      }
                    }}
                  >
                    {cards.map((card) => (
                      <BoardCardTile
                        key={card.id}
                        card={card}
                        highlighted={board.recentlyMovedCardIds.has(card.id)}
                        onOpenThread={() => openCardThread(card)}
                        onOpenDrawer={() => setDrawerCardId(card.id)}
                        onDragStart={() => setDraggedCardId(card.id)}
                        onDragEnd={() => {
                          setDraggedCardId(null);
                          setHoveredStage(null);
                        }}
                      />
                    ))}
                  </BoardColumn>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <BoardAddAppDialog
        open={addAppOpen}
        apps={state.apps}
        loadProjects={board.loadT3Projects}
        onCreate={handleCreateApp}
        onOpenChange={setAddAppOpen}
      />

      <BoardCardDrawer
        cardId={drawerCardId}
        stages={state.stages}
        loadCard={board.loadCard}
        onMove={(cardId, to) => {
          setDrawerCardId(null);
          void performMove(cardId, to);
        }}
        onClose={() => setDrawerCardId(null)}
      />
    </SidebarInset>
  );
}

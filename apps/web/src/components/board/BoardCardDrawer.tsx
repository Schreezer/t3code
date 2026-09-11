import { useEffect, useState } from "react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Sheet, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from "../ui/sheet";
import { Spinner } from "../ui/spinner";
import { selectableBoardStages } from "./boardLogic";
import type { BoardCardDetail, BoardStage, BoardStageId } from "./boardTypes";

const ACTOR_CLASS_NAME: Record<string, string> = {
  user: "text-warning-foreground",
  manager: "text-info-foreground",
  daemon: "text-muted-foreground",
};

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Prose({ text }: { text: string }) {
  return (
    <pre className="m-0 whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-3 font-sans text-[13px] leading-relaxed text-foreground/90">
      {text}
    </pre>
  );
}

/**
 * Everything the board cannot fit on a card: the body, the plan, every linked
 * thread and the stage history, plus the keyboard path to the move the drag
 * gesture performs.
 */
export function BoardCardDrawer(props: {
  readonly cardId: number | null;
  readonly stages: ReadonlyArray<BoardStage>;
  readonly loadCard: (cardId: number) => Promise<BoardCardDetail>;
  readonly onMove: (cardId: number, to: BoardStageId) => void;
  readonly onClose: () => void;
}) {
  const { cardId, loadCard } = props;
  // Tagged with the card it belongs to, so the previously opened card never
  // shows through while the next one loads and the drawer keeps its content
  // through the closing transition.
  const [loaded, setLoaded] = useState<{
    cardId: number;
    detail: BoardCardDetail | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (cardId === null) return;
    let disposed = false;
    loadCard(cardId)
      .then((detail) => {
        if (!disposed) setLoaded({ cardId, detail, error: null });
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setLoaded({
            cardId,
            detail: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      disposed = true;
    };
  }, [cardId, loadCard]);

  const current = loaded !== null && (cardId === null || loaded.cardId === cardId) ? loaded : null;
  const detail = current?.detail ?? null;
  const loadError = current?.error ?? null;
  const card = detail?.card ?? null;
  const stageLabel = (id: BoardStageId) =>
    props.stages.find((stage) => stage.id === id)?.label ?? id;

  return (
    <Sheet
      open={cardId !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <SheetPopup side="right" className="gap-0">
        <SheetHeader>
          <SheetTitle className="pe-8 text-lg">{card?.title ?? `Card #${cardId ?? ""}`}</SheetTitle>
          {card ? (
            <p className="font-mono text-xs text-muted-foreground">
              {`#${card.id} · ${card.type} · ${stageLabel(card.stage)} · ${card.appId}`}
            </p>
          ) : null}
        </SheetHeader>
        <SheetPanel className="flex flex-col gap-5">
          {loadError ? (
            <p className="text-sm text-destructive-foreground">{loadError}</p>
          ) : detail === null || card === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading card…
            </div>
          ) : (
            <>
              <DrawerSection title="Move to…">
                <Select
                  value=""
                  onValueChange={(value) => {
                    if (typeof value === "string" && value.length > 0) {
                      props.onMove(card.id, value);
                    }
                  }}
                >
                  <SelectTrigger size="sm" aria-label="Move card to stage">
                    <SelectValue placeholder="Choose a stage">Choose a stage</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {selectableBoardStages(props.stages, card.stage).map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        {stage.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </DrawerSection>

              <DrawerSection title="Body">
                {card.bodyMd.trim().length > 0 ? (
                  <Prose text={card.bodyMd} />
                ) : (
                  <p className="text-sm text-muted-foreground">No description.</p>
                )}
              </DrawerSection>

              {card.planMd ? (
                <DrawerSection title="Plan">
                  <Prose text={card.planMd} />
                </DrawerSection>
              ) : null}

              <DrawerSection title="Threads">
                {card.threads.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No linked threads.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {card.threads.map((thread) => (
                      <li
                        key={thread.threadId}
                        className="flex flex-col gap-1 rounded-lg border p-2.5"
                      >
                        <span className="truncate font-mono text-xs text-foreground">
                          {thread.threadId}
                        </span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge size="sm" variant="secondary">
                            {thread.role}
                          </Badge>
                          {thread.state ? thread.state.status : "not observed"}
                          {thread.state?.branch ? ` · ${thread.state.branch}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </DrawerSection>

              <DrawerSection title="Stage events">
                {detail.events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No stage changes yet.</p>
                ) : (
                  <ul className="flex flex-col">
                    {detail.events.map((event) => (
                      <li
                        key={`${event.at}-${event.actor}-${event.fromStage ?? ""}-${event.toStage}`}
                        className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 border-b py-1.5 font-mono text-[11px] text-muted-foreground last:border-b-0"
                      >
                        <span
                          className={cn(
                            "font-semibold",
                            ACTOR_CLASS_NAME[event.actor] ?? "text-muted-foreground",
                          )}
                        >
                          {event.actor}
                        </span>
                        <span className="break-words">
                          {`${event.fromStage ? `${stageLabel(event.fromStage)} → ` : ""}${stageLabel(event.toStage)}${
                            event.note ? `  (${event.note})` : ""
                          }`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </DrawerSection>
            </>
          )}
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}

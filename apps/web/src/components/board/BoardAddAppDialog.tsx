import { RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Spinner } from "../ui/spinner";
import { boardAppIdPreview, boardProjectChoices } from "./boardLogic";
import type { BoardApp, BoardT3Project } from "./boardTypes";

/**
 * Registers a T3 project as a t3kan app. The daemon owns the whole job —
 * slugging the id, finding the environment, writing the manager contract into
 * the workspace — so this only has to name a project and a display name.
 */
export function BoardAddAppDialog(props: {
  readonly open: boolean;
  readonly apps: ReadonlyArray<BoardApp>;
  readonly loadProjects: () => Promise<ReadonlyArray<BoardT3Project>>;
  /** Resolves true once the app exists; the dialog then closes. */
  readonly onCreate: (input: { projectId: string; name: string }) => Promise<boolean>;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { open, loadProjects } = props;
  const [projectId, setProjectId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Tagged with the attempt it answers, so a retry's result never loses to the
  // failed load it replaced.
  const [loaded, setLoaded] = useState<{
    attempt: number;
    projects: ReadonlyArray<BoardT3Project> | null;
    error: string | null;
  } | null>(null);

  /** `attempt` carries no data; bumping it is how the retry button reloads. */
  const request = useMemo(() => ({ open, loadProjects, attempt }), [attempt, loadProjects, open]);

  useEffect(() => {
    if (!request.open) return;
    let disposed = false;
    request
      .loadProjects()
      .then((projects) => {
        if (!disposed) setLoaded({ attempt: request.attempt, projects, error: null });
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setLoaded({
            attempt: request.attempt,
            projects: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      disposed = true;
    };
  }, [request]);

  const current = loaded?.attempt === attempt ? loaded : null;
  const projects = current?.projects ?? null;
  const loadError = current?.error ?? null;
  const choices = boardProjectChoices(projects ?? [], props.apps);
  const allRegistered =
    choices.length > 0 && choices.every((choice) => choice.registeredAs !== null);

  // Closing forgets the choice, so a stale project can never be submitted the
  // next time the dialog opens.
  const close = () => {
    setProjectId(null);
    setName("");
    setPending(false);
    props.onOpenChange(false);
  };

  const submit = async () => {
    if (projectId === null || pending) return;
    setPending(true);
    const created = await props.onCreate({ projectId, name: name.trim() });
    if (created) close();
    else setPending(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) props.onOpenChange(true);
        else close();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add app</DialogTitle>
          <DialogDescription>
            Register a T3 project with the board. The daemon writes the manager contract into the
            project's workspace.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Project</span>
            {loadError !== null ? (
              <div className="flex flex-col items-start gap-2 rounded-lg border p-3">
                <p className="text-sm text-destructive-foreground">{loadError}</p>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setAttempt((count) => count + 1)}
                >
                  <RefreshCwIcon />
                  Try again
                </Button>
              </div>
            ) : projects === null ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Loading projects…
              </div>
            ) : choices.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This daemon does not see any T3 projects.
              </p>
            ) : (
              <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                {choices.map(({ project, registeredAs }) => (
                  <li key={project.id}>
                    <button
                      type="button"
                      disabled={registeredAs !== null}
                      aria-pressed={projectId === project.id}
                      onClick={() => {
                        setProjectId(project.id);
                        setName(project.title);
                      }}
                      className={cn(
                        "flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg border p-2.5 text-left outline-hidden hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
                        projectId === project.id && "border-primary bg-accent/40",
                        registeredAs !== null &&
                          "cursor-not-allowed opacity-64 hover:bg-transparent",
                      )}
                    >
                      <span className="flex w-full items-center gap-2 text-[13px] font-medium text-foreground">
                        <span className="truncate">{project.title}</span>
                        {registeredAs !== null ? (
                          <span className="ms-auto shrink-0 text-[11px] font-normal text-muted-foreground">
                            registered as {registeredAs}
                          </span>
                        ) : null}
                      </span>
                      <span className="w-full truncate font-mono text-[11px] text-muted-foreground">
                        {project.workspaceRoot}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {allRegistered ? (
              <p className="text-xs text-muted-foreground">
                Every project the daemon sees is already on the board.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="board-add-app-name" className="text-xs text-muted-foreground">
              Name
            </Label>
            <Input
              id="board-add-app-name"
              size="sm"
              placeholder="App name"
              value={name}
              disabled={projectId === null}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <span className="font-mono text-[11px] text-muted-foreground">
              id: {boardAppIdPreview(name)}
            </span>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" disabled={projectId === null || pending} onClick={() => void submit()}>
            {pending ? <Spinner className="size-4" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

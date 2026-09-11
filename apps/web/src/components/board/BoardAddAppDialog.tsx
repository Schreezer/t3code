import { FolderOpenIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { ensureLocalApi } from "../../localApi";
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
import {
  boardAppIdPreview,
  boardAppNameFromFolder,
  boardCreateAppPayload,
  boardProjectChoices,
  type BoardCreateAppInput,
} from "./boardLogic";
import type { BoardApp, BoardT3Project } from "./boardTypes";

/**
 * Registers a folder as a t3kan app. The daemon owns the whole job — slugging
 * the id, reusing or creating the T3 project rooted at the folder, writing the
 * manager contract into it — so this only has to name a folder and a display
 * name. The project list is a quick pick for folders T3 already knows.
 */
export function BoardAddAppDialog(props: {
  readonly open: boolean;
  readonly apps: ReadonlyArray<BoardApp>;
  readonly loadProjects: () => Promise<ReadonlyArray<BoardT3Project>>;
  /** Resolves true once the app exists; the dialog then closes. */
  readonly onCreate: (input: BoardCreateAppInput) => Promise<boolean>;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { open, loadProjects } = props;
  const [folder, setFolder] = useState("");
  const [project, setProject] = useState<BoardT3Project | null>(null);
  const [name, setName] = useState("");
  // Once the name is typed in it stops following the folder, so a hand-written
  // name survives the rest of the path being typed.
  const [nameEdited, setNameEdited] = useState(false);
  const [picking, setPicking] = useState(false);
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
  const payload = boardCreateAppPayload({ folder, name, selectedProject: project });

  /** A folder the user typed or browsed to is no longer a project quick pick. */
  const enterFolder = (next: string) => {
    setFolder(next);
    setProject(null);
    if (!nameEdited) setName(boardAppNameFromFolder(next));
  };

  const pickProject = (next: BoardT3Project) => {
    setFolder(next.workspaceRoot);
    setProject(next);
    setName(next.title);
    setNameEdited(false);
  };

  const browse = async () => {
    setPicking(true);
    try {
      const trimmed = folder.trim();
      const picked = await ensureLocalApi().dialogs.pickFolder(
        trimmed.length > 0 ? { initialPath: trimmed } : undefined,
      );
      if (picked) enterFolder(picked);
    } catch {
      // Leave the dialog as it was; the user can type the path instead.
    } finally {
      setPicking(false);
    }
  };

  // Closing forgets the choice, so a stale folder can never be submitted the
  // next time the dialog opens.
  const close = () => {
    setFolder("");
    setProject(null);
    setName("");
    setNameEdited(false);
    setPending(false);
    props.onOpenChange(false);
  };

  const submit = async () => {
    if (payload === null || pending) return;
    setPending(true);
    const created = await props.onCreate(payload);
    if (created) close();
    else setPending(false);
  };

  const submitOnEnter = (event: { key: string; preventDefault: () => void }) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void submit();
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
            Register a folder with the board. The daemon writes the manager contract into it, and
            creates a T3 project for it when there is not one already.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="board-add-app-folder" className="text-xs text-muted-foreground">
              Folder
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="board-add-app-folder"
                size="sm"
                className="font-mono"
                placeholder="~/code/my-app"
                value={folder}
                onChange={(event) => enterFolder(event.target.value)}
                onKeyDown={submitOnEnter}
              />
              {isElectron ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={picking}
                  onClick={() => void browse()}
                >
                  {picking ? <Spinner className="size-4" /> : <FolderOpenIcon />}
                  Browse…
                </Button>
              ) : null}
            </div>
            <span className="text-[11px] text-muted-foreground">
              An absolute path on the daemon's machine. `~` is allowed.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Or pick an existing project
            </span>
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
              <ul className="flex max-h-52 flex-col gap-1 overflow-y-auto">
                {choices.map(({ project: choice, registeredAs }) => (
                  <li key={choice.id}>
                    <button
                      type="button"
                      disabled={registeredAs !== null}
                      aria-pressed={project?.id === choice.id}
                      onClick={() => pickProject(choice)}
                      className={cn(
                        "flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg border p-2.5 text-left outline-hidden hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
                        project?.id === choice.id && "border-primary bg-accent/40",
                        registeredAs !== null &&
                          "cursor-not-allowed opacity-64 hover:bg-transparent",
                      )}
                    >
                      <span className="flex w-full items-center gap-2 text-[13px] font-medium text-foreground">
                        <span className="truncate">{choice.title}</span>
                        {registeredAs !== null ? (
                          <span className="ms-auto shrink-0 text-[11px] font-normal text-muted-foreground">
                            registered as {registeredAs}
                          </span>
                        ) : null}
                      </span>
                      <span className="w-full truncate font-mono text-[11px] text-muted-foreground">
                        {choice.workspaceRoot}
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
              onChange={(event) => {
                setNameEdited(true);
                setName(event.target.value);
              }}
              onKeyDown={submitOnEnter}
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
          <Button size="sm" disabled={payload === null || pending} onClick={() => void submit()}>
            {pending ? <Spinner className="size-4" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

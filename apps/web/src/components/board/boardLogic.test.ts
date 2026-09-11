import { describe, expect, it } from "vite-plus/test";

import {
  boardApiUrl,
  boardAppIdPreview,
  boardAppNameFromFolder,
  boardCreateAppPayload,
  boardProjectChoices,
  boardSocketUrl,
  newestBoardThread,
  normalizeBoardDaemonUrl,
  resolveBoardDropPreview,
  resolveBoardManagerRoute,
  resolveBoardStatusChip,
  resolveBoardThreadRoute,
  selectableBoardStages,
  visibleBoardStages,
} from "./boardLogic";
import type {
  BoardApp,
  BoardCard,
  BoardStage,
  BoardT3Project,
  BoardThread,
  BoardThreadState,
} from "./boardTypes";

function thread(role: string, state: Partial<BoardThreadState> | null): BoardThread {
  return {
    threadId: `thread-${role}`,
    role,
    linkedAt: "2026-09-11T12:00:00.000Z",
    state:
      state === null
        ? null
        : {
            status: "completed",
            activeRunId: null,
            pendingRequest: null,
            branch: null,
            worktreePath: null,
            pullRequests: [],
            ...state,
          },
  };
}

function card(overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    id: 1,
    appId: "forge",
    title: "A card",
    type: "bug",
    stage: "discussing",
    bodyMd: "",
    planMd: null,
    stageChangedBy: "user",
    stageChangedAt: "2026-09-11T12:00:00.000Z",
    threads: [],
    primaryThreadId: null,
    primaryIsManager: false,
    ...overrides,
  };
}

const stages: ReadonlyArray<BoardStage> = [
  { id: "discussing", label: "Discussing", enteredBy: "both", collapsed: false, hidden: false },
  {
    id: "implementing",
    label: "Implementing",
    enteredBy: "daemon",
    collapsed: false,
    hidden: false,
  },
  { id: "later", label: "Later", enteredBy: "both", collapsed: true, hidden: false },
  { id: "dropped", label: "Dropped", enteredBy: "both", collapsed: false, hidden: true },
];

describe("normalizeBoardDaemonUrl", () => {
  it("drops trailing slashes", () => {
    expect(normalizeBoardDaemonUrl("http://127.0.0.1:4131/")).toBe("http://127.0.0.1:4131");
  });

  it("falls back to the default when blank", () => {
    expect(normalizeBoardDaemonUrl("   ")).toBe("http://127.0.0.1:4131");
  });
});

describe("boardApiUrl", () => {
  it("appends the path and query to the configured base", () => {
    expect(boardApiUrl("http://127.0.0.1:4131/", "api/state", { app: "forge", dropped: "1" })).toBe(
      "http://127.0.0.1:4131/api/state?app=forge&dropped=1",
    );
  });
});

describe("boardSocketUrl", () => {
  it("swaps http for ws", () => {
    expect(boardSocketUrl("http://127.0.0.1:4131", { app: "forge" })).toBe(
      "ws://127.0.0.1:4131/ws?app=forge",
    );
  });

  it("swaps https for wss", () => {
    expect(boardSocketUrl("https://board.example")).toBe("wss://board.example/ws");
  });
});

describe("newestBoardThread", () => {
  it("prefers the newest work thread over a manager thread", () => {
    const manager = thread("manage", null);
    const implement = thread("implement", null);
    expect(newestBoardThread(card({ threads: [manager, implement] }))).toBe(implement);
  });

  it("falls back to the newest linked thread", () => {
    const manager = thread("manage", null);
    expect(newestBoardThread(card({ threads: [manager] }))).toBe(manager);
  });

  it("is null without threads", () => {
    expect(newestBoardThread(card())).toBeNull();
  });
});

describe("resolveBoardStatusChip", () => {
  it("is null when no thread state has been observed", () => {
    expect(resolveBoardStatusChip(card({ threads: [thread("implement", null)] }))).toBeNull();
  });

  it("puts a pending request ahead of a running status", () => {
    const chip = resolveBoardStatusChip(
      card({ threads: [thread("implement", { status: "running", pendingRequest: "approval" })] }),
    );
    expect(chip).toEqual({ tone: "waiting", label: "needs approval" });
  });

  it("labels other pending requests as input", () => {
    const chip = resolveBoardStatusChip(
      card({ threads: [thread("implement", { status: "waiting", pendingRequest: "question" })] }),
    );
    expect(chip).toEqual({ tone: "waiting", label: "needs input" });
  });

  it("shows the branch alongside a running thread", () => {
    const chip = resolveBoardStatusChip(
      card({ threads: [thread("implement", { status: "running", branch: "fix/empty-log" })] }),
    );
    expect(chip).toEqual({ tone: "running", label: "running · fix/empty-log" });
  });

  it("prefers the newest pull request over the terminal status", () => {
    const chip = resolveBoardStatusChip(
      card({
        threads: [
          thread("implement", {
            status: "completed",
            pullRequests: [
              { number: 4, url: "", state: "open" },
              { number: 9, url: "", state: "open" },
            ],
          }),
        ],
      }),
    );
    expect(chip).toEqual({ tone: "done", label: "PR #9" });
  });

  it("marks failure-shaped statuses as failed", () => {
    const chip = resolveBoardStatusChip(
      card({ threads: [thread("implement", { status: "cancelled" })] }),
    );
    expect(chip).toEqual({ tone: "failed", label: "cancelled" });
  });
});

describe("resolveBoardDropPreview", () => {
  it("shows nothing when no card is being dragged", () => {
    expect(resolveBoardDropPreview({ stageId: "discussing", draggedCardStage: null })).toBe("none");
  });

  it("shows nothing over the card's own column", () => {
    expect(resolveBoardDropPreview({ stageId: "later", draggedCardStage: "later" })).toBe("none");
  });

  it("refuses the daemon-only columns", () => {
    expect(resolveBoardDropPreview({ stageId: "implementing", draggedCardStage: "later" })).toBe(
      "refused",
    );
    expect(resolveBoardDropPreview({ stageId: "review", draggedCardStage: "later" })).toBe(
      "refused",
    );
  });

  it("allows an ordinary column", () => {
    expect(resolveBoardDropPreview({ stageId: "discussing", draggedCardStage: "later" })).toBe(
      "allowed",
    );
  });
});

describe("selectableBoardStages", () => {
  it("drops the daemon-only stages and the current one", () => {
    expect(selectableBoardStages(stages, "discussing").map((stage) => stage.id)).toEqual([
      "later",
      "dropped",
    ]);
  });
});

describe("visibleBoardStages", () => {
  it("hides dropped until asked for", () => {
    expect(visibleBoardStages(stages, false).map((stage) => stage.id)).toEqual([
      "discussing",
      "implementing",
      "later",
    ]);
    expect(visibleBoardStages(stages, true)).toHaveLength(4);
  });
});

describe("resolveBoardThreadRoute", () => {
  const apps: ReadonlyArray<BoardApp> = [
    {
      id: "forge",
      name: "Forge",
      projectId: "project",
      managerThreadId: "manager-thread",
      webBaseUrl: "http://localhost:7721",
      environmentId: "5b31be85-e516-4dc9-8b70-1223aa16f143",
    },
  ];

  it("pairs the app's environment with the card's primary thread", () => {
    expect(resolveBoardThreadRoute(card({ primaryThreadId: "thread-1" }), apps)).toEqual({
      environmentId: "5b31be85-e516-4dc9-8b70-1223aa16f143",
      threadId: "thread-1",
    });
  });

  it("is null without a thread to open", () => {
    expect(resolveBoardThreadRoute(card(), apps)).toBeNull();
  });

  it("is null when the card's app is unknown", () => {
    expect(
      resolveBoardThreadRoute(card({ appId: "other", primaryThreadId: "t" }), apps),
    ).toBeNull();
  });
});

describe("boardAppIdPreview", () => {
  it("mirrors the daemon's slug rule", () => {
    expect(boardAppIdPreview("Forge")).toBe("forge");
    expect(boardAppIdPreview("  My App v2! ")).toBe("my-app-v2");
    expect(boardAppIdPreview("t3 code / web")).toBe("t3-code-web");
  });

  it("falls back to a usable id", () => {
    expect(boardAppIdPreview("")).toBe("app");
    expect(boardAppIdPreview("!!!")).toBe("app");
  });

  it("caps the id the way the daemon does", () => {
    expect(boardAppIdPreview("a".repeat(60))).toBe("a".repeat(40));
  });
});

describe("boardProjectChoices", () => {
  const projects: ReadonlyArray<BoardT3Project> = [
    { id: "p1", title: "Forge", workspaceRoot: "/src/forge", appId: "forge" },
    { id: "p2", title: "Anvil", workspaceRoot: "/src/anvil", appId: null },
    { id: "p3", title: "Ingot", workspaceRoot: "/src/ingot", appId: "ingot" },
  ];
  const apps: ReadonlyArray<BoardApp> = [
    {
      id: "forge",
      name: "Forge",
      projectId: "p1",
      managerThreadId: "manager-thread",
      webBaseUrl: null,
      environmentId: "env",
    },
  ];

  it("floats unregistered projects and names the app of the rest", () => {
    expect(
      boardProjectChoices(projects, apps).map((choice) => [choice.project.id, choice.registeredAs]),
    ).toEqual([
      ["p2", null],
      ["p1", "Forge"],
      ["p3", "ingot"],
    ]);
  });
});

describe("resolveBoardManagerRoute", () => {
  const app: BoardApp = {
    id: "forge",
    name: "Forge",
    projectId: "p1",
    managerThreadId: "manager-thread",
    webBaseUrl: null,
    environmentId: "5b31be85-e516-4dc9-8b70-1223aa16f143",
  };

  it("routes to the app's manager thread", () => {
    expect(resolveBoardManagerRoute(app)).toEqual({
      environmentId: "5b31be85-e516-4dc9-8b70-1223aa16f143",
      threadId: "manager-thread",
    });
  });

  it("is null before the app has a manager or an environment", () => {
    expect(resolveBoardManagerRoute({ ...app, managerThreadId: null })).toBeNull();
    expect(resolveBoardManagerRoute({ ...app, environmentId: null })).toBeNull();
    expect(resolveBoardManagerRoute(null)).toBeNull();
  });
});

describe("boardAppNameFromFolder", () => {
  it("names the app after the folder", () => {
    expect(boardAppNameFromFolder("/src/forge")).toBe("forge");
    expect(boardAppNameFromFolder("~/code/my-app/")).toBe("my-app");
    expect(boardAppNameFromFolder("  /src/forge  ")).toBe("forge");
    expect(boardAppNameFromFolder("C:\\code\\anvil")).toBe("anvil");
  });

  it("prefills nothing when the path names no folder yet", () => {
    expect(boardAppNameFromFolder("")).toBe("");
    expect(boardAppNameFromFolder("/")).toBe("");
    expect(boardAppNameFromFolder("~")).toBe("");
    expect(boardAppNameFromFolder("~/")).toBe("");
  });
});

describe("boardCreateAppPayload", () => {
  const selectedProject = { id: "p2", workspaceRoot: "/src/anvil" };

  it("has nothing to submit without a folder", () => {
    expect(
      boardCreateAppPayload({ folder: "  ", name: "Anvil", selectedProject: null }),
    ).toBeNull();
  });

  it("sends a typed folder as a workspace root", () => {
    expect(
      boardCreateAppPayload({ folder: "  ~/code/anvil ", name: " Anvil ", selectedProject: null }),
    ).toEqual({ workspaceRoot: "~/code/anvil", name: "Anvil" });
  });

  it("omits a blank name so the daemon picks one", () => {
    expect(
      boardCreateAppPayload({ folder: "/src/anvil", name: "   ", selectedProject: null }),
    ).toEqual({ workspaceRoot: "/src/anvil" });
  });

  it("sends the project id for an untouched quick pick", () => {
    expect(boardCreateAppPayload({ folder: "/src/anvil", name: "Anvil", selectedProject })).toEqual(
      {
        projectId: "p2",
        name: "Anvil",
      },
    );
  });

  it("falls back to the workspace root once the picked path is edited", () => {
    expect(
      boardCreateAppPayload({ folder: "/src/anvil/web", name: "Web", selectedProject }),
    ).toEqual({ workspaceRoot: "/src/anvil/web", name: "Web" });
  });
});

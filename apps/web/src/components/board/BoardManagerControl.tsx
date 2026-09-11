import { ChevronDownIcon, MessagesSquareIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { resolveBoardManagerRoute } from "./boardLogic";
import type { BoardApp } from "./boardTypes";

const NEW_SESSION_HINT = "A new session starts a fresh thread; the board state is kept.";

/**
 * The app's manager thread in one control: open the thread it already has, or
 * start one. "New manager session" is the way to clear the manager's context —
 * the daemon settles the old thread and launches a fresh one in the same
 * project, so the board keeps every card.
 */
export function BoardManagerControl(props: {
  readonly app: BoardApp;
  readonly pending: boolean;
  readonly onOpen: () => void;
  readonly onNewSession: () => void;
}) {
  const { app, pending } = props;
  const hasManager = resolveBoardManagerRoute(app) !== null;

  if (!hasManager) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button size="xs" variant="outline" disabled={pending} onClick={props.onNewSession} />
          }
        >
          {pending ? <Spinner className="size-3.5" /> : <MessagesSquareIcon />}
          Create manager
        </TooltipTrigger>
        <TooltipPopup side="bottom">Start the manager thread for {app.name}.</TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Group>
      <Tooltip>
        <TooltipTrigger
          render={<Button size="xs" variant="outline" disabled={pending} onClick={props.onOpen} />}
        >
          {pending ? <Spinner className="size-3.5" /> : <MessagesSquareIcon />}
          Manager
        </TooltipTrigger>
        <TooltipPopup side="bottom">Open the manager thread for {app.name}.</TooltipPopup>
      </Tooltip>
      <GroupSeparator />
      <Menu>
        <MenuTrigger
          disabled={pending}
          render={<Button size="icon-xs" variant="outline" aria-label="Manager options" />}
        >
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuPopup align="end" className="max-w-64">
          <MenuItem onClick={props.onNewSession}>New manager session</MenuItem>
          <p className="px-2 py-1 text-[11px] leading-snug text-muted-foreground">
            {NEW_SESSION_HINT}
          </p>
        </MenuPopup>
      </Menu>
    </Group>
  );
}

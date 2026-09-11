import { DEFAULT_BOARD_DAEMON_URL } from "@t3tools/contracts/settings";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { DraftInput } from "../ui/draft-input";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

/**
 * Where the board view looks for the t3kan daemon. The daemon is a separate
 * loopback process, so its address is a client preference rather than
 * environment settings: a remote browser pointed at this server still talks to
 * the daemon beside it.
 */
export function BoardSettings() {
  const daemonUrl = useClientSettings((settings) => settings.boardDaemonUrl);
  const updateSettings = useUpdateClientSettings();

  return (
    <SettingsSection id="board" title="Board">
      <SettingsRow
        title="t3kan daemon URL"
        description="The kanban daemon the Board view reads cards from. Start it with `t3kan serve`."
        resetAction={
          daemonUrl === DEFAULT_BOARD_DAEMON_URL ? null : (
            <SettingResetButton
              label="t3kan daemon URL"
              onClick={() => updateSettings({ boardDaemonUrl: DEFAULT_BOARD_DAEMON_URL })}
            />
          )
        }
        control={
          <DraftInput
            size="sm"
            className="w-full sm:w-64"
            aria-label="t3kan daemon URL"
            placeholder={DEFAULT_BOARD_DAEMON_URL}
            value={daemonUrl}
            onCommit={(next) => updateSettings({ boardDaemonUrl: next.trim() })}
          />
        }
      />
    </SettingsSection>
  );
}

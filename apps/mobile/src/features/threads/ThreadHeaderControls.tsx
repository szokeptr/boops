import { Toolbar } from "../../components/ui/Toolbar";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";

import {
  basename,
  getTerminalStatusLabel,
  type TerminalMenuSession,
} from "../terminal/terminalMenu";

type HeaderItem = Record<string, unknown>;
type HeaderItems = HeaderItem[];

export type ThreadHeaderControlsProps = {
  readonly environmentId: EnvironmentId | string;
  readonly threadId: ThreadId | string;
  readonly onOpenFilesInspector?: () => void;
  readonly auxiliaryPaneControl?: {
    readonly accessibilityLabel: string;
    readonly onPress: () => void;
  };
  readonly canOpenTerminal: boolean;
  readonly canOperateTerminal: boolean;
  readonly canOpenFiles: boolean;
  readonly terminalSessions: ReadonlyArray<TerminalMenuSession>;
  readonly showActionControls?: boolean;
  readonly showDirectFileControl?: boolean;
  readonly onOpenTerminal: (terminalId?: string | null) => void;
  readonly onOpenNewTerminal: () => void;
};

function useOpenFiles(props: ThreadHeaderControlsProps) {
  const navigation = useNavigation();
  return () => {
    if (props.onOpenFilesInspector) {
      props.onOpenFilesInspector();
      return;
    }
    navigation.navigate("ThreadFiles", {
      environmentId: String(props.environmentId),
      threadId: String(props.threadId),
    });
  };
}

function terminalSessionSubtitle(session: TerminalMenuSession) {
  return [
    getTerminalStatusLabel({
      status: session.status,
      hasRunningSubprocess: session.hasRunningSubprocess,
    }),
    basename(session.cwd),
  ]
    .filter(Boolean)
    .join(" · ");
}

function useThreadHeaderActionItems(props: ThreadHeaderControlsProps) {
  const openFiles = useOpenFiles(props);

  return {
    terminal: {
      accessibilityLabel: "Open terminal",
      disabled: !props.canOpenTerminal,
      icon: { name: "terminal", type: "sfSymbol" },
      identifier: "thread-right-terminal",
      label: "Terminal",
      menu: {
        items: [
          ...props.terminalSessions.map((session) => ({
            description: terminalSessionSubtitle(session),
            icon: { name: "terminal", type: "sfSymbol" as const },
            label: session.displayLabel,
            onPress: () => props.onOpenTerminal(session.terminalId),
            type: "action" as const,
          })),
          {
            description: "Start another shell for this thread",
            disabled: !props.canOperateTerminal,
            icon: { name: "plus", type: "sfSymbol" },
            label: "Open new terminal",
            onPress: props.onOpenNewTerminal,
            type: "action",
          },
        ],
        title: "Terminal",
      },
      sharesBackground: true,
      type: "menu",
      variant: "plain",
    },
    files: {
      accessibilityLabel: "Open files",
      disabled: !props.canOpenFiles,
      icon: { name: "folder", type: "sfSymbol" },
      identifier: "thread-right-files",
      label: "Files",
      onPress: openFiles,
      sharesBackground: true,
      type: "button",
      variant: "plain",
    },
  } satisfies Record<string, HeaderItem>;
}

/** One "…" menu for phones, where the conversation keeps the bar to itself. */
export function useThreadOverflowHeaderItems(props: ThreadHeaderControlsProps): HeaderItems {
  const { files, terminal } = useThreadHeaderActionItems(props);
  return [
    {
      accessibilityLabel: "More",
      icon: { name: "ellipsis", type: "sfSymbol" },
      identifier: "thread-right-more",
      menu: {
        items: [
          {
            disabled: files.disabled,
            icon: files.icon,
            label: files.label,
            onPress: files.onPress,
            type: "action",
          },
          ...(terminal.disabled
            ? []
            : [
                {
                  icon: terminal.icon,
                  items: terminal.menu.items,
                  title: "Terminal",
                  type: "submenu",
                },
              ]),
        ],
      },
      sharesBackground: true,
      type: "menu",
      variant: "plain",
    },
  ];
}

export function useThreadCenterHeaderItems(props: ThreadHeaderControlsProps): HeaderItems {
  const actionItems = useThreadHeaderActionItems(props);
  return [actionItems.files, actionItems.terminal];
}

export function ThreadHeaderControls(props: ThreadHeaderControlsProps) {
  const openFiles = useOpenFiles(props);

  if (!(props.showActionControls ?? true)) {
    return null;
  }

  return (
    <Toolbar placement="right">
      {props.auxiliaryPaneControl ? (
        <Toolbar.Button
          accessibilityLabel={props.auxiliaryPaneControl.accessibilityLabel}
          icon="sidebar.right"
          onPress={props.auxiliaryPaneControl.onPress}
          separateBackground
        />
      ) : null}
      <Toolbar.Menu
        accessibilityLabel="Open terminal"
        icon="terminal"
        disabled={!props.canOpenTerminal}
        separateBackground
      >
        {props.terminalSessions.map((session) => (
          <Toolbar.MenuAction
            key={session.terminalId}
            icon="terminal"
            onPress={() => props.onOpenTerminal(session.terminalId)}
            subtitle={terminalSessionSubtitle(session)}
          >
            <Toolbar.Label>{session.displayLabel}</Toolbar.Label>
          </Toolbar.MenuAction>
        ))}
        <Toolbar.MenuAction
          icon="plus"
          disabled={!props.canOperateTerminal}
          onPress={props.onOpenNewTerminal}
          subtitle="Start another shell for this thread"
        >
          <Toolbar.Label>Open new terminal</Toolbar.Label>
        </Toolbar.MenuAction>
      </Toolbar.Menu>
      {props.showDirectFileControl ? (
        <Toolbar.Button
          accessibilityLabel="Open files"
          disabled={!props.canOpenFiles}
          icon="folder"
          onPress={openFiles}
          separateBackground
        />
      ) : null}
    </Toolbar>
  );
}

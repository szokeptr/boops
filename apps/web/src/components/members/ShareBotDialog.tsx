import { isBotSharedWith } from "@t3tools/client-runtime/state/members";
import type { ConnectorConnection, EnvironmentMember } from "@t3tools/contracts";
import { create } from "zustand";

import { useConnectorConnections } from "../../state/connectors";
import { useProjects } from "../../state/entities";
import { useMembers } from "../../state/members";
import type { BotTarget } from "../bots/BotLifecycle";
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
import { Separator } from "../ui/separator";
import { Switch } from "../ui/switch";
import { ConnectRequiredNote, InviteMemberForm } from "./InviteMemberForm";
import { MemberStatus } from "./MemberStatus";
import { useMemberCommands } from "./useMemberCommands";

const useShareDialog = create<{ bot: BotTarget | null; session: number }>(() => ({
  bot: null,
  session: 0,
}));

/** Opens Share for a bot. The bot menu, chat header and command palette all call this. */
export function openShareBotDialog(bot: BotTarget) {
  useShareDialog.setState((state) => ({ bot, session: state.session + 1 }));
}

function closeShareDialog() {
  useShareDialog.setState({ bot: null });
}

export function ShareBotDialogHost() {
  const bot = useShareDialog((state) => state.bot);
  const session = useShareDialog((state) => state.session);
  return bot ? <ShareBotDialog key={session} bot={bot} /> : null;
}

function ShareBotDialog({ bot }: { readonly bot: BotTarget }) {
  const project = useProjects().find(
    (candidate) => candidate.environmentId === bot.environmentId && candidate.id === bot.projectId,
  );
  const { allowed, members, canInvite, loaded, error } = useMembers(bot.environmentId);
  const { setBotAccess, setBotConnectionAccess, invite } = useMemberCommands(bot.environmentId);
  const { connections } = useConnectorConnections(allowed ? bot.environmentId : null);
  const botConnections = connections.filter((connection) =>
    (project?.connectionIds ?? []).includes(connection.id),
  );
  const sharedConnections = new Set<string>(project?.memberConnectionIds ?? []);
  const sharedWithAnyone = (project?.memberIds ?? []).length > 0;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeShareDialog();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share {bot.name}</DialogTitle>
          <DialogDescription>
            People you share it with chat with {bot.name} from the Boops app on their phone.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {!allowed ? (
            <p className="text-muted-foreground text-sm">
              This session can't share bots on this machine.
            </p>
          ) : !loaded ? (
            <p className="text-muted-foreground text-sm">
              {error === null ? "Loading people…" : "Could not load people."}
            </p>
          ) : (
            <>
              {members.length > 0 ? (
                <ul className="grid gap-1" aria-label="People">
                  {members.map((member) => (
                    <ShareRow
                      key={member.id}
                      member={member}
                      shared={project !== undefined && isBotSharedWith(project, member.id)}
                      onChange={(enabled) =>
                        void setBotAccess({
                          projectId: bot.projectId,
                          memberId: member.id,
                          enabled,
                        })
                      }
                    />
                  ))}
                </ul>
              ) : null}
              {sharedWithAnyone && botConnections.length > 0 ? (
                <>
                  <Separator />
                  <div className="flex flex-col gap-1">
                    <h3 className="font-medium text-sm">Connections they can use</h3>
                    <p className="text-muted-foreground text-xs">
                      These are your accounts. {bot.name} acts as you when it uses them.
                    </p>
                    <ul className="grid gap-1" aria-label="Connections">
                      {botConnections.map((connection) => (
                        <ConnectionShareRow
                          key={connection.id}
                          connection={connection}
                          shared={sharedConnections.has(connection.id)}
                          onChange={(enabled) =>
                            void setBotConnectionAccess({
                              projectId: bot.projectId,
                              connectionId: connection.id,
                              enabled,
                            })
                          }
                        />
                      ))}
                    </ul>
                  </div>
                </>
              ) : null}
              {members.length > 0 ? <Separator /> : null}
              <div className="flex flex-col gap-2">
                <h3 className="font-medium text-sm">Invite someone</h3>
                {canInvite ? (
                  <InviteMemberForm
                    autoFocus={members.length === 0}
                    submitLabel={`Invite and share ${bot.name}`}
                    onInvite={(input) => invite({ ...input, projectIds: [bot.projectId] })}
                  />
                ) : (
                  <ConnectRequiredNote onNavigate={closeShareDialog} />
                )}
              </div>
            </>
          )}
          <p className="text-muted-foreground text-xs">
            They chat in their own threads. You won't see their chats, and they won't see yours.
          </p>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button onClick={closeShareDialog}>Done</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ShareRow(props: {
  readonly member: EnvironmentMember;
  readonly shared: boolean;
  readonly onChange: (enabled: boolean) => void;
}) {
  const { member } = props;
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{member.label}</span>
        <span className="truncate text-muted-foreground text-xs">
          {member.email} · <MemberStatus member={member} />
        </span>
      </span>
      <Switch
        checked={props.shared}
        aria-label={`Share with ${member.label}`}
        onCheckedChange={props.onChange}
      />
    </li>
  );
}

function ConnectionShareRow(props: {
  readonly connection: ConnectorConnection;
  readonly shared: boolean;
  readonly onChange: (enabled: boolean) => void;
}) {
  const { connection } = props;
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm">{connection.displayName}</span>
      <Switch
        checked={props.shared}
        aria-label={`Let them use ${connection.displayName}`}
        onCheckedChange={props.onChange}
      />
    </li>
  );
}

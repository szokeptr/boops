import { isBotSharedWith } from "@t3tools/client-runtime/state/members";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, EnvironmentMember, ProjectId } from "@t3tools/contracts";
import { UserPlusIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentBots } from "../../state/connectors";
import type { EnvironmentPresentation } from "../../state/environments";
import { useMembers } from "../../state/members";
import { ConnectRequiredNote, InviteMemberForm } from "../members/InviteMemberForm";
import { LastSeen } from "../members/MemberStatus";
import { useMemberCommands } from "../members/useMemberCommands";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Toggle } from "../ui/toggle";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const PRIVACY_NOTE =
  "They chat in their own threads. You won't see their chats, and they won't see yours.";

export function MembersSettingsPanel() {
  const { environment } = useSettingsScope();
  return (
    <SettingsPageContainer>
      {environment?.connection.phase === "connected" ? (
        <EnvironmentMembers key={environment.environmentId} environment={environment} />
      ) : (
        <SettingsSection {...searchableSetting("members")}>
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Connect an environment to manage who can chat with its bots.
          </p>
        </SettingsSection>
      )}
    </SettingsPageContainer>
  );
}

function EnvironmentMembers({ environment }: { readonly environment: EnvironmentPresentation }) {
  const environmentId = environment.environmentId;
  const { allowed, members, canInvite, loaded, error } = useMembers(environmentId);
  const bots = useEnvironmentBots(environmentId);
  const [inviting, setInviting] = useState(false);
  const inviteButton = (
    <Button size="xs" variant="ghost" onClick={() => setInviting(true)}>
      <UserPlusIcon />
      Invite
    </Button>
  );
  return (
    <>
      <SettingsSection
        {...searchableSetting("members")}
        headerAction={allowed && canInvite && members.length > 0 ? inviteButton : undefined}
      >
        {!allowed ? (
          <SettingsRow
            title="This session can't manage people."
            description={`Only the owner of ${environment.label} can invite people and share bots.`}
          />
        ) : !loaded ? (
          <SettingsRow
            title={error === null ? "Loading people…" : "Could not load people."}
            description={error ?? undefined}
          />
        ) : members.length === 0 ? (
          <SettingsRow
            title="No one yet."
            description={`Invite someone to chat with your bots from the Boops app on their phone. ${PRIVACY_NOTE}`}
            control={canInvite ? inviteButton : undefined}
          />
        ) : (
          members.map((member) => (
            <MemberRow key={member.id} environmentId={environmentId} member={member} bots={bots} />
          ))
        )}
        {allowed && loaded && !canInvite ? (
          <div className="px-3 py-3 sm:px-4">
            <ConnectRequiredNote />
          </div>
        ) : null}
      </SettingsSection>
      {members.length > 0 ? (
        <p className="px-3 text-xs text-muted-foreground sm:px-4">{PRIVACY_NOTE}</p>
      ) : null}
      {inviting ? (
        <InviteMemberDialog
          environmentId={environmentId}
          bots={bots}
          onClose={() => setInviting(false)}
        />
      ) : null}
    </>
  );
}

function MemberRow(props: {
  readonly environmentId: EnvironmentId;
  readonly member: EnvironmentMember;
  readonly bots: ReadonlyArray<EnvironmentProject>;
}) {
  const { member, bots } = props;
  const { setBotAccess, remove } = useMemberCommands(props.environmentId);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <SettingsRow
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate">{member.label}</span>
            <Badge variant={member.status === "active" ? "success" : "outline"}>
              {member.status === "active" ? "Active" : "Invited"}
            </Badge>
          </span>
        }
        description={
          <>
            {member.email}
            <LastSeen member={member} prefix=" · " />
          </>
        }
        control={
          <Button size="xs" variant="ghost-destructive" onClick={() => setConfirming(true)}>
            Remove…
          </Button>
        }
      >
        {bots.length === 0 ? null : (
          <ul
            aria-label={`Bots shared with ${member.label}`}
            className="flex flex-wrap gap-1.5 pb-2"
          >
            {bots.map((bot) => (
              <li key={bot.id}>
                <Toggle
                  size="xs"
                  variant="outline"
                  pressed={isBotSharedWith(bot, member.id)}
                  aria-label={`Share ${bot.title} with ${member.label}`}
                  onPressedChange={(pressed) =>
                    void setBotAccess({ projectId: bot.id, memberId: member.id, enabled: pressed })
                  }
                >
                  <ProjectFavicon project={bot} className="size-3.5" />
                  {bot.title}
                </Toggle>
              </li>
            ))}
          </ul>
        )}
      </SettingsRow>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {member.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to every bot right away and are signed out on their devices. Their
              chats stay on this machine, archived, and you still won't see them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                void remove(member);
              }}
            >
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

function InviteMemberDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly bots: ReadonlyArray<EnvironmentProject>;
  readonly onClose: () => void;
}) {
  const { invite } = useMemberCommands(props.environmentId);
  const [projectIds, setProjectIds] = useState<ReadonlyArray<ProjectId>>([]);
  const toggle = (projectId: ProjectId, checked: boolean) =>
    setProjectIds((current) =>
      checked ? [...current, projectId] : current.filter((id) => id !== projectId),
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite someone</DialogTitle>
          <DialogDescription>
            They sign in to Boops Connect on their phone with this email, accept, and chat with the
            bots you pick. {PRIVACY_NOTE}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <InviteMemberForm
            autoFocus
            submitLabel="Invite"
            onInvite={async (input) => {
              const invited = await invite({ ...input, projectIds: [...projectIds] });
              if (invited) props.onClose();
              return invited;
            }}
          >
            {props.bots.length === 0 ? null : (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 font-medium text-sm">Bots they can chat with</legend>
                {props.bots.map((bot) => (
                  <label key={bot.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={projectIds.includes(bot.id)}
                      onCheckedChange={(checked) => toggle(bot.id, checked === true)}
                    />
                    <ProjectFavicon project={bot} className="size-4" />
                    <span className="min-w-0 truncate">{bot.title}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </InviteMemberForm>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

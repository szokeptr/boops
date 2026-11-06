import { useAtomValue } from "@effect/atom-react";
import {
  ArrowLeftIcon,
  ChartNoAxesColumnIcon,
  PanelLeftCloseIcon,
  SettingsIcon,
} from "lucide-react";
import { BoopsWord } from "../BoopsWordmark";
import type { ReactNode } from "react";
import { memo } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";

import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import {
  resolveEnvironmentIdentificationPillLabel,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { observeResize } from "~/lib/observeResize";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
  actions,
}: {
  isElectron: boolean;
  /** Round buttons at the header's end, outside the window drag region. */
  actions?: ReactNode;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    <div
      className={cn(
        "relative flex h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center gap-2 pr-3",
        isElectron && "drag-region",
      )}
    >
      <div className="relative z-10 flex h-8 min-w-0 flex-1 flex-wrap content-start items-center gap-x-2 overflow-hidden py-0.5">
        <SidebarBrand />
        {pillLabel ? (
          <div className="ml-1 flex h-7 items-center">
            <Badge data-environment-identification="pill" size="sm" variant="secondary">
              {pillLabel}
            </Badge>
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="relative z-10 flex shrink-0 items-center gap-2 [-webkit-app-region:no-drag]">
          {actions}
        </div>
      ) : null}
    </div>
  );
});

export function SidebarBrandWidthProbe({
  onWidthChange,
}: {
  onWidthChange: (width: number) => void;
}) {
  const observeWidth = (probe: HTMLDivElement) => {
    return observeResize(probe, ([entry]) => {
      if (entry) onWidthChange(entry.borderBoxSize[0]?.inlineSize ?? probe.offsetWidth);
    });
  };

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none invisible fixed top-0 left-0 flex w-max border-r border-transparent pr-3"
      ref={observeWidth}
    >
      <div className="ml-[var(--workspace-controls-left)] flex gap-2">
        <BoopsWord className="h-5 w-auto shrink-0" />
        {/* The header's search and add buttons. */}
        <div className="w-18" />
      </div>
    </div>
  );
}

function SidebarBrand() {
  return (
    <Link
      aria-label="Boops home"
      className="relative z-10 ml-[var(--workspace-controls-left)] flex h-7 w-fit min-w-0 shrink-0 items-center overflow-hidden rounded-md text-foreground outline-hidden ring-ring focus-visible:ring-2 focus-visible:ring-inset"
      to="/"
    >
      <BoopsWord className="h-5 w-auto shrink-0" />
    </Link>
  );
}

const SidebarToggleItem = memo(function SidebarToggleItem() {
  const { toggleSidebar } = useSidebar();
  const usagePageOpen = useLocation({ select: (location) => location.pathname === "/usage" });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle", {
    context: { usagePageOpen },
  });
  return (
    <SidebarUtilityItem
      icon={<PanelLeftCloseIcon />}
      label={`Hide sidebar${shortcutLabel ? ` (${shortcutLabel})` : ""}`}
      onClick={toggleSidebar}
    />
  );
});

function SidebarUtilityItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton aria-label={label} onClick={onClick} size="icon">
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const { isMobile, setOpenMobile } = useSidebar();
  const isOnUtilityPage = useLocation({
    select: (location) => isSidebarUtilityPage(location.pathname),
  });
  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };
  const handleSettingsClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  };

  const handleUsageClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  };

  const handleBackClick = () => {
    closeMobileSidebar();
    void navigateToMainApp();
  };

  return (
    <SidebarMenu className="flex-row items-center">
      <SidebarToggleItem />
      {isOnUtilityPage ? (
        <SidebarMenuItem className="min-w-0 flex-1">
          <SidebarMenuButton onClick={handleBackClick}>
            <ArrowLeftIcon />
            <span>Back</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : (
        <>
          <SidebarUtilityItem
            icon={<SettingsIcon />}
            label="Settings"
            onClick={handleSettingsClick}
          />
          <SidebarUtilityItem
            icon={<ChartNoAxesColumnIcon />}
            label="Usage"
            onClick={handleUsageClick}
          />
        </>
      )}
      <SidebarThreadUndoNotice />
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter>
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});

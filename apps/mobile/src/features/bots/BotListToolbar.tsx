export interface BotListToolbarProps {
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onOpenEnvironments: () => void;
  readonly onRequestVisibility?: () => void;
}

/** iOS lists use native header items; only Android draws this toolbar. */
export function BotListToolbar(_props: BotListToolbarProps) {
  return null;
}

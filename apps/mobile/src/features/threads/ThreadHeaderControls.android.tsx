import type {
  ThreadHeaderControls as IosThreadHeaderControls,
  useThreadCenterHeaderItems as useIosThreadCenterHeaderItems,
} from "./ThreadHeaderControls";

type ThreadHeaderControlsProps = Parameters<typeof IosThreadHeaderControls>[0];
const EMPTY_HEADER_ITEMS: ReturnType<typeof useIosThreadCenterHeaderItems> = [];

// oxlint-disable-next-line t3code/no-hookless-use-function -- Android stub of a hook; the iOS file calls hooks.
export function useThreadOverflowHeaderItems(_props: ThreadHeaderControlsProps) {
  return EMPTY_HEADER_ITEMS;
}

// oxlint-disable-next-line t3code/no-hookless-use-function -- Android stub of a hook; the iOS file calls hooks.
export function useThreadCenterHeaderItems(_props: ThreadHeaderControlsProps) {
  return EMPTY_HEADER_ITEMS;
}

export function ThreadHeaderControls(_props: ThreadHeaderControlsProps) {
  return null;
}

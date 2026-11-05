import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

// Pixel "boops": letters follow the theme colour; the "oo" are the mascot's glowing eyes.
const INK =
  "M0 0h2v1h-2zM0 1h2v1h-2zM11 1h1v1h-1zM0 2h4v1h-4zM7 2h3v1h-3zM13 2h3v1h-3zM18 2h4v1h-4zM25 2h4v1h-4zM0 3h2v1h-2zM3 3h2v1h-2zM6 3h1v1h-1zM10 3h1v1h-1zM12 3h1v1h-1zM16 3h1v1h-1zM18 3h2v1h-2zM21 3h2v1h-2zM24 3h2v1h-2zM0 4h2v1h-2zM3 4h2v1h-2zM6 4h1v1h-1zM10 4h1v1h-1zM12 4h1v1h-1zM16 4h1v1h-1zM18 4h2v1h-2zM21 4h2v1h-2zM25 4h3v1h-3zM0 5h2v1h-2zM3 5h2v1h-2zM6 5h1v1h-1zM10 5h1v1h-1zM12 5h1v1h-1zM16 5h1v1h-1zM18 5h2v1h-2zM21 5h2v1h-2zM27 5h2v1h-2zM0 6h4v1h-4zM7 6h3v1h-3zM13 6h3v1h-3zM18 6h4v1h-4zM24 6h4v1h-4zM18 7h2v1h-2zM18 8h2v1h-2z";
const GLOW =
  "M11 0h1v1h-1zM8 3h2v1h-2zM14 3h2v1h-2zM7 4h3v1h-3zM13 4h3v1h-3zM7 5h3v1h-3zM13 5h3v1h-3z";
const SHINE = "M7 3h1v1h-1zM13 3h1v1h-1z";
const EYE_GLOW = "#86FFCF";

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = 29 / 9;
  return (
    <Svg
      accessibilityLabel="Boops"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="0 0 29 9"
    >
      <ThemedPath
        d={INK}
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
      <Path d={GLOW} fill={EYE_GLOW} />
      <Path d={SHINE} fill="#FFFFFF" />
    </Svg>
  );
}

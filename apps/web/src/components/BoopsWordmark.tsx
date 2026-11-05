import type { SVGProps } from "react";

const INK =
  "M0 0h2v1h-2zM0 1h2v1h-2zM11 1h1v1h-1zM0 2h4v1h-4zM7 2h3v1h-3zM13 2h3v1h-3zM18 2h4v1h-4zM25 2h4v1h-4zM0 3h2v1h-2zM3 3h2v1h-2zM6 3h1v1h-1zM10 3h1v1h-1zM12 3h1v1h-1zM16 3h1v1h-1zM18 3h2v1h-2zM21 3h2v1h-2zM24 3h2v1h-2zM0 4h2v1h-2zM3 4h2v1h-2zM6 4h1v1h-1zM10 4h1v1h-1zM12 4h1v1h-1zM16 4h1v1h-1zM18 4h2v1h-2zM21 4h2v1h-2zM25 4h3v1h-3zM0 5h2v1h-2zM3 5h2v1h-2zM6 5h1v1h-1zM10 5h1v1h-1zM12 5h1v1h-1zM16 5h1v1h-1zM18 5h2v1h-2zM21 5h2v1h-2zM27 5h2v1h-2zM0 6h4v1h-4zM7 6h3v1h-3zM13 6h3v1h-3zM18 6h4v1h-4zM24 6h4v1h-4zM18 7h2v1h-2zM18 8h2v1h-2z";
const GLOW =
  "M11 0h1v1h-1zM8 3h2v1h-2zM14 3h2v1h-2zM7 4h3v1h-3zM13 4h3v1h-3zM7 5h3v1h-3zM13 5h3v1h-3z";
const SHINE = "M7 3h1v1h-1zM13 3h1v1h-1z";

// Pixel "boops": letters follow currentColor; the "oo" are the mascot's glowing eyes.
export function BoopsWordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      role="img"
      aria-label="Boops"
      {...props}
      viewBox="0 0 29 9"
      shapeRendering="crispEdges"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={INK} fill="currentColor" />
      <path d={GLOW} fill="var(--color-boops-glow)" />
      <path d={SHINE} fill="var(--color-white)" />
    </svg>
  );
}

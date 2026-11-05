import type { SVGProps } from "react";

// The Boops mascot's head as a single-colour pixel mark, for icon-sized slots.
export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 16 16" shapeRendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 0h2v1h-2zM6 1h4v1h-4zM7 2h2v1h-2zM7 3h2v1h-2zM2 4h12v1h-12zM1 5h14v1h-14zM1 6h3v1h-3zM12 6h3v1h-3zM1 7h2v1h-2zM5 7h2v1h-2zM9 7h2v1h-2zM13 7h2v1h-2zM0 8h3v1h-3zM5 8h2v1h-2zM9 8h2v1h-2zM13 8h3v1h-3zM0 9h3v1h-3zM13 9h3v1h-3zM0 10h3v1h-3zM6 10h1v1h-1zM9 10h1v1h-1zM13 10h3v1h-3zM1 11h3v1h-3zM7 11h2v1h-2zM12 11h3v1h-3zM1 12h14v1h-14zM1 13h14v1h-14zM2 14h12v1h-12zM3 15h10v1h-10z" fill="currentColor" />
    </svg>
  );
}

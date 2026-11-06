import type { SVGProps } from "react";

// The Boops visor as a single-colour mark (eyes cut out), for icon-sized slots.
export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <path
        fillRule="evenodd"
        fill="currentColor"
        d="M20 18h24a14 14 0 0 1 0 28H20a14 14 0 0 1 0-28zM22 24.5a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0v-7a4 4 0 0 0-4-4zM42 24.5a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0v-7a4 4 0 0 0-4-4z"
      />
    </svg>
  );
}

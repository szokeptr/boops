// One pointer listener steers every watching avatar's eyes, batched to a frame: reads, then writes.
const watchers = new Set<SVGGElement>();
let pointer: { readonly x: number; readonly y: number } | null = null;
let frame = 0;

/** Canvas units the eyes travel; they look within REACH pixels and settle back beyond it. */
const TRAVEL_X = 4.5;
const TRAVEL_Y = 3;
const REACH = 300;
const FULL_TILT = 50;

function steer() {
  frame = 0;
  if (!pointer) return;
  const { x, y } = pointer;
  const targets = [...watchers].map((eyes) => {
    const box = eyes.ownerSVGElement?.getBoundingClientRect();
    if (!box) return { eyes, offset: "" };
    const dx = x - (box.left + box.width / 2);
    const dy = y - (box.top + box.height * 0.52);
    const distance = Math.hypot(dx, dy);
    if (distance === 0 || distance > REACH) return { eyes, offset: "" };
    const tilt = Math.min(1, distance / FULL_TILT) / distance;
    return { eyes, offset: `${dx * tilt * TRAVEL_X}px ${dy * tilt * TRAVEL_Y}px` };
  });
  for (const { eyes, offset } of targets) eyes.style.translate = offset;
}

function onPointerMove(event: PointerEvent) {
  pointer = { x: event.clientX, y: event.clientY };
  if (frame === 0) frame = requestAnimationFrame(steer);
}

/** Has `eyes` look toward the pointer until the returned function stops it. */
export function watchPointer(eyes: SVGGElement): () => void {
  if (watchers.size === 0) window.addEventListener("pointermove", onPointerMove, { passive: true });
  watchers.add(eyes);
  return () => {
    watchers.delete(eyes);
    eyes.style.translate = "";
    if (watchers.size > 0) return;
    window.removeEventListener("pointermove", onPointerMove);
    cancelAnimationFrame(frame);
    frame = 0;
  };
}

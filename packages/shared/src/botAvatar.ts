import {
  BOT_AVATAR_ACCESSORIES,
  BOT_AVATAR_GLOWS,
  BOT_AVATAR_HUES,
  BOT_AVATAR_SHAPES,
  type BotAvatarShape,
  type ProjectAvatar,
} from "@t3tools/contracts";

// The server picks a new bot's look and clients draw fallbacks, so both must hash identically.
function hash(text: string): number {
  let h = 2166136261;
  for (const char of text) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const pick = <T>(options: ReadonlyArray<T>, seed: string, salt: string): T =>
  options[hash(`${seed}#${salt}`) % options.length]!;

/** The look a name seeds before any sibling is considered. */
export function specFor(name: string): ProjectAvatar {
  return {
    hue: pick(BOT_AVATAR_HUES, name, "hue"),
    accessory: pick(BOT_AVATAR_ACCESSORIES, name, "acc"),
    glow: pick(BOT_AVATAR_GLOWS, name, "glow"),
    shape: pick(BOT_AVATAR_SHAPES, name, "shape"),
  };
}

/** A stored look with its shape filled in; looks saved before shapes take the one the name seeds. */
export function lookFor(avatar: ProjectAvatar | null | undefined, name: string): ProjectAvatar {
  if (!avatar) return specFor(name);
  return avatar.shape ? avatar : { ...avatar, shape: specFor(name).shape };
}

// Strides coprime with 12 and 8, so stepping visits every hue, accessory, and shape.
const HUE_STRIDE = 5;
const ACCESSORY_STRIDE = 3;
const SHAPE_STRIDE = 5;

/** Steps to the nearest shape no sibling wears; shape is what tells bots apart in small lists. */
function settleShape(
  shape: BotAvatarShape | undefined,
  siblings: ReadonlyArray<ProjectAvatar>,
): BotAvatarShape {
  const taken = new Set(siblings.map((sibling) => sibling.shape));
  let at = BOT_AVATAR_SHAPES.indexOf(shape ?? BOT_AVATAR_SHAPES[0]);
  if (BOT_AVATAR_SHAPES.every((candidate) => taken.has(candidate))) return BOT_AVATAR_SHAPES[at]!;
  while (taken.has(BOT_AVATAR_SHAPES[at]!)) at = (at + SHAPE_STRIDE) % BOT_AVATAR_SHAPES.length;
  return BOT_AVATAR_SHAPES[at]!;
}

function settle(spec: ProjectAvatar, siblings: ReadonlyArray<ProjectAvatar>): ProjectAvatar {
  return { ...settleHueAndAccessory(spec, siblings), shape: settleShape(spec.shape, siblings) };
}

/** Steps to the nearest hue and accessory no sibling uses, then to a free pair once those run out. */
function settleHueAndAccessory(
  spec: ProjectAvatar,
  siblings: ReadonlyArray<ProjectAvatar>,
): ProjectAvatar {
  const hueCount = BOT_AVATAR_HUES.length;
  const accessoryCount = BOT_AVATAR_ACCESSORIES.length;
  const hues = new Set(siblings.map((sibling) => sibling.hue));
  const accessories = new Set(siblings.map((sibling) => sibling.accessory));
  let hue = BOT_AVATAR_HUES.indexOf(spec.hue);
  let accessory = BOT_AVATAR_ACCESSORIES.indexOf(spec.accessory);
  if (hues.size < hueCount) {
    while (hues.has(BOT_AVATAR_HUES[hue]!)) hue = (hue + HUE_STRIDE) % hueCount;
  }
  if (accessories.size < accessoryCount) {
    while (accessories.has(BOT_AVATAR_ACCESSORIES[accessory]!)) {
      accessory = (accessory + ACCESSORY_STRIDE) % accessoryCount;
    }
  }
  const taken = new Set(siblings.map((sibling) => `${sibling.hue}/${sibling.accessory}`));
  for (let a = 0; a < accessoryCount; a++) {
    for (let h = 0; h < hueCount; h++) {
      const candidate = {
        ...spec,
        hue: BOT_AVATAR_HUES[(hue + h * HUE_STRIDE) % hueCount]!,
        accessory: BOT_AVATAR_ACCESSORIES[(accessory + a * ACCESSORY_STRIDE) % accessoryCount]!,
      };
      if (!taken.has(`${candidate.hue}/${candidate.accessory}`)) return candidate;
    }
  }
  return { ...spec, hue: BOT_AVATAR_HUES[hue]!, accessory: BOT_AVATAR_ACCESSORIES[accessory]! };
}

/** A new bot's look: seeded from its name, stepped away from the looks its siblings use. */
export function familySpec(name: string, siblings: ReadonlyArray<ProjectAvatar>): ProjectAvatar {
  return settle(specFor(name), siblings);
}

const MAX_REROLL_ATTEMPTS = 16;

/** A fresh random look that differs from `current` and still avoids the siblings' looks. */
export function rerollSpec(
  current: ProjectAvatar,
  siblings: ReadonlyArray<ProjectAvatar>,
  random: () => number = Math.random,
): ProjectAvatar {
  const any = <T>(options: ReadonlyArray<T>): T =>
    options[Math.floor(random() * options.length) % options.length]!;
  let next = current;
  for (let attempt = 0; attempt < MAX_REROLL_ATTEMPTS; attempt++) {
    next = settle(
      {
        hue: any(BOT_AVATAR_HUES),
        accessory: any(BOT_AVATAR_ACCESSORIES),
        glow: any(BOT_AVATAR_GLOWS),
        shape: any(BOT_AVATAR_SHAPES),
      },
      siblings,
    );
    if (
      next.hue !== current.hue ||
      next.accessory !== current.accessory ||
      next.glow !== current.glow ||
      next.shape !== current.shape
    ) {
      return next;
    }
  }
  return next;
}

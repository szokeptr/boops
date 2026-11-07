import { adopt } from "alchemy/AdoptPolicy";
import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";

const repoRoot = new URL("../..", import.meta.url).pathname;

export default Alchemy.Stack(
  "BoopsSite",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const marketing = yield* Cloudflare.Website.StaticSite("Marketing", {
      cwd: repoRoot,
      command: "vp run --filter @t3tools/marketing build",
      outdir: "apps/marketing/dist",
      memo: false,
      assets: { htmlHandling: "drop-trailing-slash", notFoundHandling: "404-page" },
      domain: { name: "getboops.com", redirects: ["www.getboops.com"] },
    });

    // The hosted app bakes its Clerk and relay config in from the repo .env at build time.
    const web = yield* Cloudflare.Website.StaticSite("Web", {
      cwd: repoRoot,
      command: "sh infra/site/build-web.sh",
      outdir: "apps/web/dist",
      memo: false,
      env: {
        VITE_HOSTED_APP_URL: "https://app.getboops.com",
        VITE_HOSTED_APP_CHANNEL: "latest",
      },
      assets: { notFoundHandling: "single-page-application" },
      domain: { name: "app.getboops.com" },
    });

    return { marketing: marketing.url, web: web.url };
  }).pipe(adopt(true)),
);

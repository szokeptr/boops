#!/bin/sh
# Builds the hosted web app for app.getboops.com. Run from the repo root.
set -eu
vp run --filter @t3tools/web build
node scripts/apply-web-brand-assets.ts --channel latest
cp infra/site/web-routing/_redirects infra/site/web-routing/_headers apps/web/dist/

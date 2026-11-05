import type { ConnectorCatalogEntry } from "@t3tools/contracts";

const icon = (domain: string) => `https://icons.duckduckgo.com/ip3/${domain}.ico`;

const GOOGLE_SETUP_DOCS = "https://developers.google.com/workspace/guides/configure-mcp-servers";

/**
 * Google's Workspace MCP servers (Developer Preview) sign in through accounts.google.com, which has
 * no dynamic client registration, so the user brings an OAuth client. Scopes are the ones Google
 * recommends per server; it issues a refresh token only with `access_type=offline`.
 */
const google = (input: {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly host: string;
  readonly docsUrl: string;
  readonly icon: string;
  /** What to enable in Google Cloud, by display name. */
  readonly apis: string;
  readonly extraStep?: string;
  readonly scopes: ReadonlyArray<string>;
}): ConnectorCatalogEntry => ({
  id: input.id,
  name: input.name,
  description: input.description,
  url: `https://${input.host}/mcp/v1`,
  auth: {
    kind: "oauth",
    scopes: input.scopes.map((scope) => `https://www.googleapis.com/auth/${scope}`),
    authorizationParams: { access_type: "offline", prompt: "consent" },
    clientSetup: {
      docsUrl: GOOGLE_SETUP_DOCS,
      steps: [
        `In a Google Cloud project, enable the ${input.apis}.`,
        ...(input.extraStep === undefined ? [] : [input.extraStep]),
        "Under Google Auth Platform, set up the consent screen: Internal for a Workspace account, otherwise External with yourself as a test user. Add the scopes below under Data Access.",
        "Create an OAuth client of type Web application, tick “Use this client for an AI-powered agent”, and add the redirect URI below.",
        "Copy its client ID and secret here. Your other Google connections reuse them.",
      ],
    },
  },
  docsUrl: input.docsUrl,
  iconUrl: `https://ssl.gstatic.com/images/branding/product/1x/${input.icon}_48dp.png`,
});

const workspaceDocs = (product: string) =>
  `https://developers.google.com/workspace/${product}/api/guides/configure-mcp-server`;

/**
 * Remote MCP servers Boops can sign in to. Every OAuth entry was checked live (2026-11-05): a 401,
 * or for Google's servers protected-resource metadata at the well-known path, leading to
 * authorization-server metadata. Entries without dynamic client registration carry
 * `clientSetup`; others that need one (GitHub, Asana, HubSpot, Box) are not added yet.
 */
export const CONNECTOR_CATALOG: ReadonlyArray<ConnectorCatalogEntry> = [
  google({
    id: "gmail",
    name: "Gmail",
    description: "Search, read and draft email.",
    host: "gmailmcp.googleapis.com",
    docsUrl: workspaceDocs("gmail"),
    icon: "gmail_2020q4",
    apis: "Gmail API and Gmail MCP API",
    scopes: ["gmail.readonly", "gmail.compose"],
  }),
  google({
    id: "google-calendar",
    name: "Google Calendar",
    description: "Calendars, events and free time.",
    host: "calendarmcp.googleapis.com",
    docsUrl: workspaceDocs("calendar"),
    icon: "calendar_2020q4",
    apis: "Google Calendar API and Google Calendar MCP API",
    // Google lists calendar.events.readonly; the server's tools also create and change events.
    scopes: ["calendar.calendarlist.readonly", "calendar.events.freebusy", "calendar.events"],
  }),
  google({
    id: "google-drive",
    name: "Google Drive",
    description: "Search, read and create files.",
    host: "drivemcp.googleapis.com",
    docsUrl: workspaceDocs("drive"),
    icon: "drive_2020q4",
    apis: "Google Drive API and Google Drive MCP API",
    scopes: ["drive.readonly", "drive.file"],
  }),
  google({
    id: "google-docs",
    name: "Google Docs",
    description: "Read and edit documents.",
    host: "docsmcp.googleapis.com",
    docsUrl: workspaceDocs("docs"),
    icon: "docs_2020q4",
    apis: "Google Docs API and Google Docs MCP API",
    scopes: ["drive.readonly", "drive.file", "documents.readonly", "documents"],
  }),
  google({
    id: "google-sheets",
    name: "Google Sheets",
    description: "Read and edit spreadsheets.",
    host: "sheetsmcp.googleapis.com",
    docsUrl: workspaceDocs("sheets"),
    icon: "sheets_2020q4",
    apis: "Google Sheets API and Google Sheets MCP API",
    scopes: ["drive.readonly", "drive.file", "spreadsheets.readonly", "spreadsheets"],
  }),
  google({
    id: "google-slides",
    name: "Google Slides",
    description: "Read and edit presentations.",
    host: "slidesmcp.googleapis.com",
    docsUrl: workspaceDocs("slides"),
    icon: "slides_2020q4",
    apis: "Google Slides API and Google Slides MCP API",
    scopes: ["drive.readonly", "drive.file", "presentations.readonly", "presentations"],
  }),
  google({
    id: "google-chat",
    name: "Google Chat",
    description: "Search conversations, read and send messages.",
    host: "chatmcp.googleapis.com",
    docsUrl: workspaceDocs("chat"),
    icon: "chat_2020q4",
    apis: "Google Chat API and Google Chat MCP API",
    extraStep:
      "Under Google Chat API → Configuration, set up a Chat app with interactive features off.",
    scopes: [
      "chat.spaces.readonly",
      "chat.memberships.readonly",
      "chat.messages.readonly",
      "chat.messages.create",
      "chat.users.readstate",
      "chat.users.spacesettings",
    ],
  }),
  google({
    id: "google-contacts",
    name: "Google Contacts",
    description: "Your contacts, the directory and your profile.",
    host: "people.googleapis.com",
    docsUrl: GOOGLE_SETUP_DOCS,
    icon: "contacts_2022",
    apis: "People API",
    scopes: ["directory.readonly", "userinfo.profile", "contacts.readonly"],
  }),
  {
    id: "linear",
    name: "Linear",
    description: "Issues, projects and cycles.",
    url: "https://mcp.linear.app/mcp",
    auth: { kind: "oauth" },
    docsUrl: "https://linear.app/docs/mcp",
    iconUrl: icon("linear.app"),
  },
  {
    id: "notion",
    name: "Notion",
    description: "Pages, databases and search.",
    url: "https://mcp.notion.com/mcp",
    auth: { kind: "oauth" },
    docsUrl: "https://developers.notion.com/docs/mcp",
    iconUrl: icon("notion.so"),
  },
  {
    id: "atlassian",
    name: "Atlassian",
    description: "Jira issues and Confluence pages.",
    url: "https://mcp.atlassian.com/v1/mcp",
    auth: { kind: "oauth" },
    docsUrl:
      "https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/",
    iconUrl: icon("atlassian.com"),
  },
  {
    id: "todoist",
    name: "Todoist",
    description: "Tasks and projects.",
    url: "https://ai.todoist.net/mcp",
    auth: { kind: "oauth" },
    docsUrl: "https://www.todoist.com/help/articles/use-todoist-with-ai-assistants",
    iconUrl: icon("todoist.com"),
  },
  {
    id: "clickup",
    name: "ClickUp",
    description: "Tasks, docs and spaces.",
    url: "https://mcp.clickup.com/mcp",
    auth: { kind: "oauth" },
    docsUrl: "https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server",
    iconUrl: icon("clickup.com"),
  },
  {
    id: "monday",
    name: "monday.com",
    description: "Boards, items and updates.",
    url: "https://mcp.monday.com/mcp",
    auth: { kind: "oauth" },
    docsUrl: "https://developer.monday.com/apps/docs/mondaycom-mcp-integration",
    iconUrl: icon("monday.com"),
  },
  {
    id: "airtable",
    name: "Airtable",
    description: "Bases, tables and records.",
    url: "https://mcp.airtable.com/mcp",
    auth: { kind: "oauth" },
    docsUrl: "https://support.airtable.com/docs/using-the-airtable-mcp-server",
    iconUrl: icon("airtable.com"),
  },
  {
    id: "gitlab",
    name: "GitLab",
    description: "Projects, issues and merge requests on gitlab.com.",
    url: "https://gitlab.com/api/v4/mcp",
    auth: { kind: "oauth" },
    docsUrl: "https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/",
    iconUrl: icon("gitlab.com"),
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Errors, issues and releases.",
    url: "https://mcp.sentry.dev/mcp",
    auth: { kind: "oauth" },
    docsUrl: "https://docs.sentry.io/product/sentry-mcp/",
    iconUrl: icon("sentry.io"),
  },
  {
    id: "posthog",
    name: "PostHog",
    description: "Product analytics, feature flags and errors.",
    url: "https://mcp.posthog.com/mcp",
    auth: { kind: "oauth" },
    docsUrl: "https://posthog.com/docs/model-context-protocol",
    iconUrl: icon("posthog.com"),
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    description: "Your Cloudflare account through its API.",
    url: "https://mcp.cloudflare.com/mcp",
    auth: { kind: "oauth" },
    docsUrl:
      "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/",
    iconUrl: icon("cloudflare.com"),
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Projects, deployments and logs.",
    url: "https://mcp.vercel.com",
    auth: { kind: "oauth" },
    docsUrl: "https://vercel.com/docs/mcp/vercel-mcp",
    iconUrl: icon("vercel.com"),
  },
  {
    id: "netlify",
    name: "Netlify",
    description: "Sites, deploys and forms.",
    url: "https://netlify-mcp.netlify.app/mcp",
    auth: { kind: "oauth" },
    docsUrl: "https://docs.netlify.com/build/build-with-ai/netlify-mcp-server/",
    iconUrl: icon("netlify.com"),
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Projects, databases and edge functions.",
    url: "https://mcp.supabase.com/mcp",
    auth: { kind: "oauth" },
    docsUrl: "https://supabase.com/docs/guides/getting-started/mcp",
    iconUrl: icon("supabase.com"),
  },
  {
    id: "neon",
    name: "Neon",
    description: "Serverless Postgres projects and branches.",
    url: "https://mcp.neon.tech/mcp",
    auth: { kind: "oauth" },
    docsUrl: "https://neon.com/docs/ai/neon-mcp-server",
    iconUrl: icon("neon.tech"),
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Payments, customers and invoices.",
    url: "https://mcp.stripe.com",
    auth: { kind: "oauth" },
    docsUrl: "https://docs.stripe.com/mcp",
    iconUrl: icon("stripe.com"),
  },
  {
    id: "paypal",
    name: "PayPal",
    description: "Invoices, orders and transactions.",
    url: "https://mcp.paypal.com/mcp",
    auth: { kind: "oauth" },
    docsUrl: "https://developer.paypal.com/tools/mcp-server/",
    iconUrl: icon("paypal.com"),
  },
  {
    id: "intercom",
    name: "Intercom",
    description: "Conversations and contacts.",
    url: "https://mcp.intercom.com/mcp",
    auth: { kind: "oauth" },
    docsUrl: "https://developers.intercom.com/docs/guides/mcp",
    iconUrl: icon("intercom.com"),
  },
  {
    id: "zapier",
    name: "Zapier",
    description: "Actions in thousands of apps through your Zapier account.",
    url: "https://mcp.zapier.com/api/mcp/mcp",
    auth: { kind: "oauth" },
    docsUrl: "https://docs.zapier.com/mcp/home",
    iconUrl: icon("zapier.com"),
  },
  {
    id: "canva",
    name: "Canva",
    description: "Designs, folders and brand templates.",
    url: "https://mcp.canva.com/mcp",
    auth: { kind: "oauth" },
    docsUrl: "https://www.canva.dev/docs/mcp/",
    iconUrl: icon("canva.com"),
  },
  {
    id: "figma",
    name: "Figma",
    description: "Design files, components and variables.",
    url: "https://mcp.figma.com/mcp",
    auth: { kind: "oauth" },
    docsUrl: "https://developers.figma.com/docs/figma-mcp-server/",
    iconUrl: icon("figma.com"),
  },
  {
    id: "exa",
    name: "Exa",
    description: "Web search and page contents.",
    url: "https://mcp.exa.ai/mcp",
    auth: { kind: "none" },
    docsUrl: "https://docs.exa.ai/reference/exa-mcp",
    iconUrl: icon("exa.ai"),
  },
  {
    id: "context7",
    name: "Context7",
    description: "Current documentation for libraries and frameworks.",
    url: "https://mcp.context7.com/mcp",
    auth: { kind: "none" },
    docsUrl: "https://context7.com/docs",
    iconUrl: icon("context7.com"),
  },
  {
    id: "cloudflare-docs",
    name: "Cloudflare Docs",
    description: "Search Cloudflare's documentation.",
    url: "https://docs.mcp.cloudflare.com/mcp",
    auth: { kind: "none" },
    docsUrl:
      "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/",
    iconUrl: icon("cloudflare.com"),
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    description: "Models, datasets, Spaces and papers.",
    url: "https://huggingface.co/mcp",
    auth: { kind: "none" },
    docsUrl: "https://huggingface.co/docs/hub/hf-mcp-server",
    iconUrl: icon("huggingface.co"),
  },
];

export const catalogEntry = (id: string): ConnectorCatalogEntry | undefined =>
  CONNECTOR_CATALOG.find((entry) => entry.id === id);

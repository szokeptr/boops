/**
 * The client side of MCP authorization (2025-06-18): protected-resource metadata (RFC 9728),
 * authorization-server metadata (RFC 8414 / OIDC discovery), dynamic client registration
 * (RFC 7591), PKCE, the `resource` indicator (RFC 8707), and token exchange and refresh.
 * Plain functions over `HttpClient` so tests answer them in process.
 */
import { ConnectorError } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";

const HTTP_TIMEOUT = Duration.seconds(20);

export const OAuthServerInfo = Schema.Struct({
  issuer: Schema.String,
  authorizationEndpoint: Schema.String,
  tokenEndpoint: Schema.String,
  registrationEndpoint: Schema.optionalKey(Schema.String),
  tokenEndpointAuthMethods: Schema.optionalKey(Schema.Array(Schema.String)),
  /** The RFC 8707 resource: what the server's metadata names, or its canonical URL. */
  resource: Schema.String,
  scope: Schema.optionalKey(Schema.String),
});
export type OAuthServerInfo = typeof OAuthServerInfo.Type;

export const OAuthClient = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.optionalKey(Schema.String),
  tokenEndpointAuthMethod: Schema.optionalKey(Schema.String),
});
export type OAuthClient = typeof OAuthClient.Type;

export const OAuthTokens = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.optionalKey(Schema.String),
  /** Epoch milliseconds; absent when the server gave no lifetime. */
  expiresAt: Schema.optionalKey(Schema.Number),
});
export type OAuthTokens = typeof OAuthTokens.Type;

/** `Bearer resource_metadata="…", scope="…"` from a 401. */
const parseBearerChallenge = (
  header: string | undefined,
): { readonly resourceMetadata?: string; readonly scope?: string } => {
  if (header === undefined || !/^\s*bearer\b/i.test(header)) return {};
  const param = (name: string) =>
    new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(header)?.[1] ??
    new RegExp(`${name}\\s*=\\s*([^\\s,"]+)`, "i").exec(header)?.[1];
  const resourceMetadata = param("resource_metadata");
  const scope = param("scope");
  return {
    ...(resourceMetadata === undefined ? {} : { resourceMetadata }),
    ...(scope === undefined ? {} : { scope }),
  };
};

const ProtectedResourceMetadata = Schema.Struct({
  resource: Schema.optionalKey(Schema.String),
  authorization_servers: Schema.optionalKey(Schema.Array(Schema.String)),
  scopes_supported: Schema.optionalKey(Schema.Array(Schema.String)),
});
const AuthorizationServerMetadata = Schema.Struct({
  issuer: Schema.optionalKey(Schema.String),
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  registration_endpoint: Schema.optionalKey(Schema.String),
  token_endpoint_auth_methods_supported: Schema.optionalKey(Schema.Array(Schema.String)),
  code_challenge_methods_supported: Schema.optionalKey(Schema.Array(Schema.String)),
});
const RegistrationResponse = Schema.Struct({
  client_id: Schema.String,
  client_secret: Schema.optionalKey(Schema.String),
  token_endpoint_auth_method: Schema.optionalKey(Schema.String),
});
const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optionalKey(Schema.String),
  expires_in: Schema.optionalKey(Schema.Number),
});
const OAuthErrorResponse = Schema.Struct({ error: Schema.String });

const decodeJson = <S extends Schema.Decoder<unknown>>(schema: S) =>
  Schema.decodeUnknownOption(Schema.fromJsonString(schema));

export const hostOf = (url: string) => URL.parse(url)?.host ?? "server";

/** One request with a bounded wait; transport failures are `unreachable`. */
export const send = (request: HttpClientRequest.HttpClientRequest) =>
  HttpClient.HttpClient.pipe(
    Effect.flatMap((client) => client.execute(request)),
    Effect.flatMap((response) =>
      response.text.pipe(Effect.map((text) => ({ response, text }) as const)),
    ),
    Effect.timeout(HTTP_TIMEOUT),
    Effect.mapError(
      (cause) => new ConnectorError({ reason: "unreachable", detail: hostOf(request.url), cause }),
    ),
  );

const getJson = <S extends Schema.Decoder<unknown>>(url: string, schema: S) =>
  send(HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson)).pipe(
    Effect.map(({ response, text }) =>
      response.status >= 200 && response.status < 300 ? decodeJson(schema)(text) : Option.none(),
    ),
    // A missing or broken metadata document means "try the next one".
    Effect.orElseSucceed(() => Option.none<S["Type"]>()),
  );

/** The first attempt that finds something; later ones never run. */
const firstSome = <A, E, R>(attempts: ReadonlyArray<Effect.Effect<Option.Option<A>, E, R>>) =>
  attempts.reduce<Effect.Effect<Option.Option<A>, E, R>>(
    (found, attempt) => found.pipe(Effect.filterOrElse(Option.isSome, () => attempt)),
    Effect.succeed(Option.none<A>()),
  );

const trimSlash = (path: string) => (path.endsWith("/") ? path.slice(0, -1) : path);

/** RFC 8414 §3 and OIDC discovery, path-aware first. */
const authorizationServerMetadataUrls = (issuer: string): ReadonlyArray<string> => {
  const url = new URL(issuer);
  const path = trimSlash(url.pathname);
  return path === ""
    ? [
        `${url.origin}/.well-known/oauth-authorization-server`,
        `${url.origin}/.well-known/openid-configuration`,
      ]
    : [
        `${url.origin}/.well-known/oauth-authorization-server${path}`,
        `${url.origin}/.well-known/openid-configuration${path}`,
        `${url.origin}${path}/.well-known/openid-configuration`,
      ];
};

/** The MCP server URL without fragment or query, as RFC 8707 wants it. */
const canonicalResource = (serverUrl: string) => {
  const url = new URL(serverUrl);
  return `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
};

/**
 * Finds how to sign in to `serverUrl`, given the `WWW-Authenticate` of its 401 if one was seen.
 * Fails with `oauth_unsupported` when no authorization server answers.
 */
export const discover = Effect.fn("ConnectorOAuth.discover")(function* (
  serverUrl: string,
  challenge?: string,
) {
  const server = new URL(serverUrl);
  const bearer = parseBearerChallenge(challenge);
  const path = trimSlash(server.pathname);
  const prm = yield* firstSome(
    [
      ...(bearer.resourceMetadata === undefined ? [] : [bearer.resourceMetadata]),
      ...(path === "" ? [] : [`${server.origin}/.well-known/oauth-protected-resource${path}`]),
      `${server.origin}/.well-known/oauth-protected-resource`,
    ].map((url) => getJson(url, ProtectedResourceMetadata)),
  );
  // RFC 9728 §3.3: metadata for another origin's resource must not steer this one.
  const resourceMetadata = Option.getOrUndefined(
    Option.filter(
      prm,
      (metadata) =>
        metadata.resource === undefined || URL.parse(metadata.resource)?.origin === server.origin,
    ),
  );
  const issuer = resourceMetadata?.authorization_servers?.[0] ?? server.origin;
  const metadata = yield* firstSome(
    authorizationServerMetadataUrls(issuer).map((url) => getJson(url, AuthorizationServerMetadata)),
  );
  if (Option.isNone(metadata)) {
    return yield* new ConnectorError({ reason: "oauth_unsupported", detail: hostOf(issuer) });
  }
  const methods = metadata.value.code_challenge_methods_supported;
  if (methods !== undefined && !methods.includes("S256")) {
    return yield* new ConnectorError({ reason: "oauth_unsupported", detail: "no PKCE S256" });
  }
  const scopes = resourceMetadata?.scopes_supported;
  const scope =
    bearer.scope ?? (scopes !== undefined && scopes.length > 0 ? scopes.join(" ") : undefined);
  const info: OAuthServerInfo = {
    issuer: metadata.value.issuer ?? issuer,
    authorizationEndpoint: metadata.value.authorization_endpoint,
    tokenEndpoint: metadata.value.token_endpoint,
    ...(metadata.value.registration_endpoint === undefined
      ? {}
      : { registrationEndpoint: metadata.value.registration_endpoint }),
    ...(metadata.value.token_endpoint_auth_methods_supported === undefined
      ? {}
      : { tokenEndpointAuthMethods: metadata.value.token_endpoint_auth_methods_supported }),
    resource: resourceMetadata?.resource ?? canonicalResource(serverUrl),
    ...(scope === undefined ? {} : { scope }),
  };
  return info;
});

const oauthFailure = (response: HttpClientResponse.HttpClientResponse, text: string) => {
  const parsed = decodeJson(OAuthErrorResponse)(text);
  return new ConnectorError({
    reason: "oauth_failed",
    detail: Option.isSome(parsed) ? parsed.value.error : `HTTP ${response.status}`,
  });
};

const jsonBody = (value: unknown) => HttpBody.text(JSON.stringify(value), "application/json");

export const registerClient = Effect.fn("ConnectorOAuth.registerClient")(function* (
  info: OAuthServerInfo,
  redirectUri: string,
) {
  if (info.registrationEndpoint === undefined) {
    return yield* new ConnectorError({
      reason: "oauth_unsupported",
      detail: "no dynamic client registration",
    });
  }
  const { response, text } = yield* send(
    HttpClientRequest.post(info.registrationEndpoint).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.setBody(
        jsonBody({
          client_name: "Pocks",
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      ),
    ),
  );
  const registered = decodeJson(RegistrationResponse)(text);
  if (response.status < 200 || response.status >= 300 || Option.isNone(registered)) {
    return yield* oauthFailure(response, text);
  }
  const client: OAuthClient = {
    clientId: registered.value.client_id,
    ...(registered.value.client_secret === undefined
      ? {}
      : { clientSecret: registered.value.client_secret }),
    ...(registered.value.token_endpoint_auth_method === undefined
      ? {}
      : { tokenEndpointAuthMethod: registered.value.token_endpoint_auth_method }),
  };
  return client;
});

export const authorizationUrl = (
  info: OAuthServerInfo,
  client: OAuthClient,
  input: {
    readonly redirectUri: string;
    readonly codeChallenge: string;
    readonly state: string;
  },
): string => {
  const url = new URL(info.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  url.searchParams.set("resource", info.resource);
  if (info.scope !== undefined) url.searchParams.set("scope", info.scope);
  return url.toString();
};

/** A confidential client authenticates as it registered; a public one only names itself. */
const withClientAuth = (
  info: OAuthServerInfo,
  client: OAuthClient,
  params: Record<string, string>,
): { readonly body: Record<string, string>; readonly headers: Record<string, string> } => {
  if (client.clientSecret === undefined) {
    return { body: { ...params, client_id: client.clientId }, headers: {} };
  }
  const method =
    client.tokenEndpointAuthMethod ??
    (info.tokenEndpointAuthMethods?.includes("client_secret_basic") === false
      ? "client_secret_post"
      : "client_secret_basic");
  if (method === "client_secret_post") {
    return {
      body: { ...params, client_id: client.clientId, client_secret: client.clientSecret },
      headers: {},
    };
  }
  const basic = btoa(
    `${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`,
  );
  return { body: params, headers: { authorization: `Basic ${basic}` } };
};

/** Token endpoint calls fail with `oauth_failed` (the server refused) or `unreachable`. */
const requestTokens = Effect.fnUntraced(function* (
  info: OAuthServerInfo,
  client: OAuthClient,
  params: Record<string, string>,
  previousRefreshToken?: string,
) {
  const { body, headers } = withClientAuth(info, client, { ...params, resource: info.resource });
  const { response, text } = yield* send(
    HttpClientRequest.post(info.tokenEndpoint).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.setBody(HttpBody.urlParams(new URLSearchParams(body))),
    ),
  );
  const tokens = decodeJson(TokenResponse)(text);
  if (response.status < 200 || response.status >= 300 || Option.isNone(tokens)) {
    return yield* oauthFailure(response, text);
  }
  const now = yield* Clock.currentTimeMillis;
  const refreshToken = tokens.value.refresh_token ?? previousRefreshToken;
  const result: OAuthTokens = {
    accessToken: tokens.value.access_token,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(tokens.value.expires_in === undefined
      ? {}
      : { expiresAt: now + tokens.value.expires_in * 1000 }),
  };
  return result;
});

export const exchangeCode = Effect.fn("ConnectorOAuth.exchangeCode")(function* (
  info: OAuthServerInfo,
  client: OAuthClient,
  input: { readonly code: string; readonly codeVerifier: string; readonly redirectUri: string },
) {
  return yield* requestTokens(info, client, {
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
  });
});

/** Servers may rotate the refresh token; one they leave out stays valid. */
export const refresh = Effect.fn("ConnectorOAuth.refresh")(function* (
  info: OAuthServerInfo,
  client: OAuthClient,
  refreshToken: string,
) {
  return yield* requestTokens(
    info,
    client,
    { grant_type: "refresh_token", refresh_token: refreshToken },
    refreshToken,
  );
});

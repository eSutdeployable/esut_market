import { COOKIE_NAME, ONE_YEAR_MS, OAUTH_STATE_COOKIE, decodeOAuthState, encodeOAuthState } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import { createHash, randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";

type ServerOAuthState = {
  redirectUri: string;
  nonce: string;
  returnTo: string;
  codeVerifier?: string;
};

function getSafeReturnTo(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function getRedirectUri(req: Request): string {
  return `${req.protocol}://${req.get("host")}/api/oauth/callback`;
}

function createPkcePair() {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/start", (req: Request, res: Response) => {
    const returnTo = getSafeReturnTo(getQueryParam(req, "returnTo"));
    const nonce = randomBytes(32).toString("base64url");
    const redirectUri = getRedirectUri(req);
    const { codeVerifier, codeChallenge } = createPkcePair();
    const statePayload: ServerOAuthState = { redirectUri, nonce, returnTo, codeVerifier };
    const state = encodeOAuthState(statePayload as Parameters<typeof encodeOAuthState>[0]);
    const authorizeUrl = new URL(`${ENV.oAuthServerUrl}/app-auth`);
    authorizeUrl.searchParams.set("appId", ENV.appId);
    authorizeUrl.searchParams.set("redirectUri", redirectUri);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("type", "signIn");
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    res.cookie(OAUTH_STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 600_000,
    });
    res.redirect(302, authorizeUrl.toString());
  });

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    // CSRF guard: the nonce in `state` must match the one-time cookie that
    // startLogin set in the browser that began this login. An attacker can
    // forge `state`, but cannot plant this cookie in the victim's browser.
    const decodedState = decodeOAuthState(state) as ServerOAuthState;
    const { nonce } = decodedState;
    const expectedNonce = parseCookieHeader(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });

    if (!ENV.frontendUrl) {
      res.status(500).json({ error: "OAuth callback failed" });
      return;
    }

    try {
      const tokenResponse = await sdk.getTokenByCode(code, state, decodedState.codeVerifier, decodedState.redirectUri);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
        request: req,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, `${ENV.frontendUrl}${getSafeReturnTo(decodedState.returnTo)}`);
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

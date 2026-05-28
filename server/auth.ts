import crypto from "crypto";
import fs from "fs";
import path from "path";

interface UserRecord {
  id: string;
  identifier: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  provider?: "password" | "google";
  providerId?: string;
  displayName?: string;
  avatarUrl?: string;
}

interface StoredAiSettings {
  provider?: "gpt" | "gemini" | "claude" | "custom";
  apiBaseUrl?: string;
  model?: string;
  encryptedApiKey?: string;
  apiKeyIv?: string;
  apiKeyTag?: string;
  updatedAt?: string;
}

interface VerificationRecord {
  identifier: string;
  code: string;
  expiresAt: number;
}

interface SessionRecord {
  token: string;
  userId: string;
  expiresAt: number;
}

interface AppDb {
  users: UserRecord[];
  verificationCodes: VerificationRecord[];
  sessions: SessionRecord[];
  savedResearchers: Record<string, string[]>;
  userSettings: Record<string, { ai?: StoredAiSettings }>;
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app-data.json");
const SESSION_DAYS = 14;
const CODE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_STATE_TTL_SECONDS = 10 * 60;
const SHOW_DEV_CODE = process.env.NODE_ENV !== "production" || process.env.RESEARCH_AI_SHOW_DEV_CODE === "true";

function emptyDb(): AppDb {
  return { users: [], verificationCodes: [], sessions: [], savedResearchers: {}, userSettings: {} };
}

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(emptyDb(), null, 2));
}

function readDb() {
  ensureDb();
  try {
    return { ...emptyDb(), ...JSON.parse(fs.readFileSync(DB_PATH, "utf-8")) } as AppDb;
  } catch {
    return emptyDb();
  }
}

function writeDb(db: AppDb) {
  ensureDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function normalizeIdentifier(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function hashPassword(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function encryptionKey() {
  const secret = process.env.RESEARCH_AI_SECRET || process.env.SESSION_SECRET || "research-ai-local-development-secret";
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    encryptedApiKey: encrypted.toString("base64"),
    apiKeyIv: iv.toString("base64"),
    apiKeyTag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptSecret(settings?: StoredAiSettings) {
  if (!settings?.encryptedApiKey || !settings.apiKeyIv || !settings.apiKeyTag) return "";
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(settings.apiKeyIv, "base64"));
    decipher.setAuthTag(Buffer.from(settings.apiKeyTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(settings.encryptedApiKey, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function createCode() {
  return String(crypto.randomInt(100000, 999999));
}

function parseCookies(header: string | undefined) {
  return Object.fromEntries((header || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function sendJson(res: any, status: number, payload: unknown, cookies: string[] = []) {
  const headers: Record<string, string | string[]> = { "Content-Type": "application/json" };
  if (cookies.length) headers["Set-Cookie"] = cookies;
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}

function publicUser(user: UserRecord) {
  return { id: user.id, identifier: user.identifier, createdAt: user.createdAt, displayName: user.displayName, avatarUrl: user.avatarUrl };
}

function publicAiSettings(settings?: StoredAiSettings) {
  if (!settings) return undefined;
  return {
    provider: settings.provider || "gpt",
    apiBaseUrl: settings.apiBaseUrl || "",
    model: settings.model || "",
    hasApiKey: Boolean(settings.encryptedApiKey),
    updatedAt: settings.updatedAt,
  };
}

function normalizeProvider(value: unknown): StoredAiSettings["provider"] {
  const provider = String(value || "gpt");
  return provider === "gemini" || provider === "claude" || provider === "custom" ? provider : "gpt";
}

function secureCookieSuffix() {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

function sessionCookie(token: string) {
  return `research_ai_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${secureCookieSuffix()}`;
}

function clearSessionCookie() {
  return `research_ai_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookieSuffix()}`;
}

function googleStateCookie(state: string) {
  return `research_ai_google_state=${encodeURIComponent(state)}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${GOOGLE_STATE_TTL_SECONDS}${secureCookieSuffix()}`;
}

function clearGoogleStateCookie() {
  return `research_ai_google_state=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0${secureCookieSuffix()}`;
}

function redirect(res: any, location: string, cookies: string[] = []) {
  const headers: Record<string, string | string[]> = { Location: location, "Cache-Control": "no-store" };
  if (cookies.length) headers["Set-Cookie"] = cookies;
  res.writeHead(302, headers);
  res.end();
}

function requestOrigin(req: any) {
  const forwardedProto = String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || (process.env.NODE_ENV === "production" ? "https" : "http");
  const host = String(req.headers?.["x-forwarded-host"] || req.headers?.host || "localhost:3000").split(",")[0].trim();
  return `${proto}://${host}`;
}

function googleRedirectUri(req: any) {
  return process.env.GOOGLE_REDIRECT_URI?.trim() || `${requestOrigin(req)}/api/auth/google/callback`;
}

function createSession(db: AppDb, userId: string) {
  const token = createToken();
  db.sessions.push({ token, userId, expiresAt: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000 });
  db.savedResearchers[userId] ||= [];
  return token;
}

export function getCurrentUser(req: any) {
  const token = parseCookies(req.headers?.cookie).research_ai_session;
  if (!token) return undefined;
  const db = readDb();
  const session = db.sessions.find((item) => item.token === token && item.expiresAt > Date.now());
  if (!session) return undefined;
  return db.users.find((user) => user.id === session.userId);
}

export function handleRequestCode(body: any, res: any) {
  const identifier = normalizeIdentifier(body?.identifier);
  if (!identifier) return sendJson(res, 400, { error: "Email or phone is required." });
  const db = readDb();
  const code = createCode();
  db.verificationCodes = db.verificationCodes.filter((item) => item.identifier !== identifier && item.expiresAt > Date.now());
  db.verificationCodes.push({ identifier, code, expiresAt: Date.now() + CODE_TTL_MS });
  writeDb(db);
  sendJson(res, 200, {
    ok: true,
    ...(SHOW_DEV_CODE ? { devCode: code } : {}),
    message: "Verification code generated. In production, connect an email/SMS provider and stop returning devCode.",
  });
}

export function handleRegister(body: any, res: any) {
  const identifier = normalizeIdentifier(body?.identifier);
  const password = String(body?.password || "");
  const code = String(body?.code || "").trim();
  if (!identifier || password.length < 6 || !code) return sendJson(res, 400, { error: "Email/phone, password, and verification code are required. Password must be at least 6 characters." });
  const db = readDb();
  if (db.users.some((user) => user.identifier === identifier)) return sendJson(res, 409, { error: "This account already exists." });
  const verification = db.verificationCodes.find((item) => item.identifier === identifier && item.code === code && item.expiresAt > Date.now());
  if (!verification) return sendJson(res, 400, { error: "Invalid or expired verification code." });
  const salt = crypto.randomBytes(16).toString("hex");
  const user: UserRecord = { id: crypto.randomUUID(), identifier, salt, passwordHash: hashPassword(password, salt), createdAt: new Date().toISOString(), provider: "password" };
  db.users.push(user);
  const token = createSession(db, user.id);
  db.verificationCodes = db.verificationCodes.filter((item) => item.identifier !== identifier);
  writeDb(db);
  sendJson(res, 200, { user: publicUser(user) }, [sessionCookie(token)]);
}

export function handleLogin(body: any, res: any) {
  const identifier = normalizeIdentifier(body?.identifier);
  const password = String(body?.password || "");
  const db = readDb();
  const user = db.users.find((item) => item.identifier === identifier);
  if (!user || hashPassword(password, user.salt) !== user.passwordHash) return sendJson(res, 401, { error: "Invalid account or password." });
  const token = createSession(db, user.id);
  writeDb(db);
  sendJson(res, 200, { user: publicUser(user) }, [sessionCookie(token)]);
}

export function handleGoogleStart(req: any, res: any) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return sendJson(res, 503, { error: "Google sign-in is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and the matching Google OAuth redirect URL." });
  const state = createToken();
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", googleRedirectUri(req));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");
  redirect(res, authUrl.toString(), [googleStateCookie(state)]);
}

export async function handleGoogleCallback(req: any, res: any) {
  const url = new URL(req.url || "/api/auth/google/callback", requestOrigin(req));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = parseCookies(req.headers?.cookie).research_ai_google_state;
  if (!code || !state || !storedState || state !== storedState) return sendJson(res, 400, { error: "Invalid Google sign-in response." }, [clearGoogleStateCookie()]);
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return sendJson(res, 503, { error: "Google sign-in is not configured on the server." }, [clearGoogleStateCookie()]);

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleRedirectUri(req),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) return sendJson(res, 502, { error: "Google token exchange failed." }, [clearGoogleStateCookie()]);
  const tokenPayload = await tokenResponse.json() as { access_token?: string };
  if (!tokenPayload.access_token) return sendJson(res, 502, { error: "Google did not return an access token." }, [clearGoogleStateCookie()]);

  const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
  });
  if (!profileResponse.ok) return sendJson(res, 502, { error: "Google profile lookup failed." }, [clearGoogleStateCookie()]);
  const profile = await profileResponse.json() as { sub?: string; email?: string; name?: string; picture?: string };
  if (!profile.sub) return sendJson(res, 502, { error: "Google profile is missing a stable user id." }, [clearGoogleStateCookie()]);

  const identifier = normalizeIdentifier(profile.email || `google:${profile.sub}`);
  const db = readDb();
  let user = db.users.find((item) => item.provider === "google" && item.providerId === profile.sub) || db.users.find((item) => item.identifier === identifier);
  if (!user) {
    user = {
      id: crypto.randomUUID(),
      identifier,
      passwordHash: "",
      salt: "",
      createdAt: new Date().toISOString(),
      provider: "google",
      providerId: profile.sub,
      displayName: profile.name,
      avatarUrl: profile.picture,
    };
    db.users.push(user);
  } else {
    user.provider = user.provider || "google";
    user.providerId = user.providerId || profile.sub;
    user.displayName = profile.name || user.displayName;
    user.avatarUrl = profile.picture || user.avatarUrl;
  }
  const token = createSession(db, user.id);
  writeDb(db);
  redirect(res, "/", [sessionCookie(token), clearGoogleStateCookie()]);
}

export function handleMe(req: any, res: any) {
  const user = getCurrentUser(req);
  sendJson(res, 200, { user: user ? publicUser(user) : null });
}

export function handleLogout(req: any, res: any) {
  const token = parseCookies(req.headers?.cookie).research_ai_session;
  const db = readDb();
  db.sessions = db.sessions.filter((session) => session.token !== token);
  writeDb(db);
  sendJson(res, 200, { ok: true }, [clearSessionCookie()]);
}

export function handleGetSaved(req: any, res: any) {
  const user = getCurrentUser(req);
  if (!user) return sendJson(res, 401, { error: "Login required." });
  const db = readDb();
  sendJson(res, 200, { savedIds: db.savedResearchers[user.id] || [] });
}

export function handleSetSaved(req: any, body: any, res: any) {
  const user = getCurrentUser(req);
  if (!user) return sendJson(res, 401, { error: "Login required." });
  const savedIds = Array.isArray(body?.savedIds) ? body.savedIds.map(String).slice(0, 1000) : [];
  const db = readDb();
  db.savedResearchers[user.id] = Array.from(new Set(savedIds));
  writeDb(db);
  sendJson(res, 200, { savedIds: db.savedResearchers[user.id] });
}

export function getUserAiSettingsForRequest(req: any) {
  const user = getCurrentUser(req);
  if (!user) return undefined;
  const db = readDb();
  const ai = db.userSettings[user.id]?.ai;
  if (!ai) return undefined;
  return {
    provider: ai.provider,
    apiBaseUrl: ai.apiBaseUrl,
    model: ai.model,
    apiKey: decryptSecret(ai),
  };
}

export function handleGetUserSettings(req: any, res: any) {
  const user = getCurrentUser(req);
  if (!user) return sendJson(res, 401, { error: "Login required." });
  const db = readDb();
  sendJson(res, 200, { aiSettings: publicAiSettings(db.userSettings[user.id]?.ai) });
}

export function handleSetAiSettings(req: any, body: any, res: any) {
  const user = getCurrentUser(req);
  if (!user) return sendJson(res, 401, { error: "Login required." });
  const db = readDb();
  const previous = db.userSettings[user.id]?.ai || {};
  const next: StoredAiSettings = {
    ...previous,
    provider: normalizeProvider(body?.provider),
    apiBaseUrl: String(body?.apiBaseUrl || "").trim(),
    model: String(body?.model || "").trim(),
    updatedAt: new Date().toISOString(),
  };
  if (body?.clearApiKey) {
    delete next.encryptedApiKey;
    delete next.apiKeyIv;
    delete next.apiKeyTag;
  } else if (typeof body?.apiKey === "string" && body.apiKey.trim()) {
    Object.assign(next, encryptSecret(body.apiKey.trim()));
  }
  db.userSettings[user.id] = { ...(db.userSettings[user.id] || {}), ai: next };
  writeDb(db);
  sendJson(res, 200, { aiSettings: publicAiSettings(next) });
}

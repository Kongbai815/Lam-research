import crypto from "crypto";
import fs from "fs";
import path from "path";

interface UserRecord {
  id: string;
  identifier: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
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
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app-data.json");
const SESSION_DAYS = 14;
const CODE_TTL_MS = 10 * 60 * 1000;
const SHOW_DEV_CODE = process.env.NODE_ENV !== "production" || process.env.RESEARCH_AI_SHOW_DEV_CODE === "true";

function emptyDb(): AppDb {
  return { users: [], verificationCodes: [], sessions: [], savedResearchers: {} };
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
  return { id: user.id, identifier: user.identifier, createdAt: user.createdAt };
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
  const user: UserRecord = { id: crypto.randomUUID(), identifier, salt, passwordHash: hashPassword(password, salt), createdAt: new Date().toISOString() };
  const token = createToken();
  db.users.push(user);
  db.verificationCodes = db.verificationCodes.filter((item) => item.identifier !== identifier);
  db.sessions.push({ token, userId: user.id, expiresAt: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000 });
  db.savedResearchers[user.id] ||= [];
  writeDb(db);
  sendJson(res, 200, { user: publicUser(user) }, [`research_ai_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}`]);
}

export function handleLogin(body: any, res: any) {
  const identifier = normalizeIdentifier(body?.identifier);
  const password = String(body?.password || "");
  const db = readDb();
  const user = db.users.find((item) => item.identifier === identifier);
  if (!user || hashPassword(password, user.salt) !== user.passwordHash) return sendJson(res, 401, { error: "Invalid account or password." });
  const token = createToken();
  db.sessions.push({ token, userId: user.id, expiresAt: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000 });
  writeDb(db);
  sendJson(res, 200, { user: publicUser(user) }, [`research_ai_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}`]);
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
  sendJson(res, 200, { ok: true }, ["research_ai_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"]);
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

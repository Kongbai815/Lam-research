type JsonResponse = {
  writeHead: (status: number, headers: Record<string, string>) => void;
  end: (body: string) => void;
};

const DEFAULT_RANKING_TIMEOUT_MS = 30000;

function jsonResponse(res: JsonResponse, status: number, payload: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function rankingApiBaseUrl() {
  return process.env.RANKING_API_URL?.trim().replace(/\/+$/, "") || "";
}

async function fetchRankingService(pathname: string, init: RequestInit = {}) {
  const baseUrl = rankingApiBaseUrl();
  if (!baseUrl) {
    throw new Error("RANKING_API_URL is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_RANKING_TIMEOUT_MS);
  try {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    const token = process.env.RANKING_API_AUTH_TOKEN?.trim();
    if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);

    return await fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function normalizeRankRequest(body: unknown) {
  const request = body && typeof body === "object" ? { ...(body as Record<string, unknown>) } : {};
  if (typeof request.query !== "string" || !request.query.trim()) {
    throw new Error("Ranking request requires a non-empty query.");
  }
  request.query = request.query.trim();
  if (!("use_simple_ranking" in request)) request.use_simple_ranking = true;
  if (!("limit" in request)) request.limit = 30;
  return request;
}

function rankingProxyErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("non-empty query")) return 400;
  return 503;
}

export async function handleRankingHealthRequest(_body: unknown, res: JsonResponse) {
  try {
    const upstream = await fetchRankingService("/health");
    const data = await readJson(upstream);
    jsonResponse(res, upstream.ok ? 200 : upstream.status, {
      ok: upstream.ok,
      upstreamStatus: upstream.status,
      service: "ranking",
      data,
    });
  } catch (error) {
    jsonResponse(res, 503, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

export async function handleRankingRankRequest(body: unknown, res: JsonResponse) {
  try {
    const request = normalizeRankRequest(body);
    const upstream = await fetchRankingService("/rank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const data = await readJson(upstream);
    jsonResponse(res, upstream.ok ? 200 : upstream.status, data);
  } catch (error) {
    jsonResponse(res, rankingProxyErrorStatus(error), { error: error instanceof Error ? error.message : String(error) });
  }
}

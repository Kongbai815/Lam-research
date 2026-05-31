import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, Bookmark, BookmarkCheck, ChevronDown, ExternalLink, FileText, Mail, MessageCircle, Moon, Phone, Search, Send, Settings, SlidersHorizontal, Sparkles, Sun, User, X } from "lucide-react";
import { type ResearchPaper, type ResearcherRecord } from "@/lib/data";
import { cn } from "@/lib/utils";

type WeightKey = "query" | "research";
type ResearcherPool = "pool" | "top10" | "frontier";
type ChartMode = "q-r" | "q-h" | "r-h";
type TableSortKey = "rank" | "query" | "hIndex" | "recentCitations";
type SortDirection = "asc" | "desc";
type SearchModeChoice = "auto" | "author" | "topic" | "institution";
type ChatMessage = { role: "assistant" | "user"; content: string };
type FloatingPosition = { x: number; y: number };
type ThemeMode = "dark" | "light";
type AuthMode = "login" | "register";
type CurrentUser = { id: string; identifier: string; createdAt: string };
type ProviderKey = "gpt" | "gemini" | "claude" | "custom";
type ApiKeyStorageChoice = "remember" | "forget";
type ModelPreset = { label: string; value: string; description: string };
type AiAutoRequest = { id: number; prompt: string; researcherId?: string };
type AccountAiSettings = { provider: ProviderKey; apiBaseUrl: string; model: string; hasApiKey: boolean; updatedAt?: string };
type SearchMeta = {
  resultCount: number;
  worksSampled: number;
  researchers: number;
  dbResponseTimeMs?: number;
  searchMode?: "author" | "institution" | "topic";
  sourceLabel?: string;
  citationStartYear?: number;
  citationEndYear?: number;
};
type ResearchersResponse = { query: string; meta: SearchMeta; researchers: ResearcherRecord[] };
type RankingTopPaper = {
  paper_id?: string | null;
  title?: string | null;
  year?: number | null;
  similarity?: number | null;
  weighted_contribution?: number | null;
  share_of_q?: number | null;
};
type RankingApiResult = {
  researcher_id?: string;
  name?: string | null;
  institution?: string | null;
  country?: string | null;
  country_code?: string | null;
  countryCode?: string | null;
  region?: string | null;
  Q?: number | string | null;
  R?: number | string | null;
  H?: number | string | null;
  final_score?: number | string | null;
  reason?: {
    primary_driver?: string | null;
    summary?: string | null;
    highlights?: string[];
    top_papers?: RankingTopPaper[];
  };
  contribution?: {
    matched_paper_count?: number | null;
    paper_contributions?: RankingTopPaper[];
  };
  components?: Record<string, unknown>;
};
type RankingApiResponse = {
  results?: RankingApiResult[];
  pareto?: unknown;
  debug?: Record<string, unknown>;
};

interface Filters {
  weights: Record<WeightKey, number>;
  minYear: number;
  maxYear: number;
  country: string;
  pool: ResearcherPool;
  chartMode: ChartMode;
  open: Record<string, boolean>;
}

interface AppSettings {
  theme: ThemeMode;
  aiProvider: ProviderKey;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  searchHistory: boolean;
  compactRows: boolean;
  interfaceScale: number;
  localOnly: boolean;
  rememberApiKey: boolean;
  savedApiKeys: Partial<Record<ProviderKey, string>>;
  apiKeyStorageChoice: Partial<Record<ProviderKey, ApiKeyStorageChoice>>;
}

const DEFAULT_QUERY = "quantum computing algorithms";
const BRAND_NAME = "ScholarLens AI";
const BRAND_DOMAIN = "scholarlens.ai";
const TEAM_CREDIT = "Built by Yitong Wang, Tuhina Priya, and Zhike";
const PAGE_SIZE = 20;
const RESULT_LIMIT = 100;
const SAVED_PROFILE_STORAGE_KEY = "research-ai-saved-profiles";
const DEFAULT_INVESTMENT_PROMPT = [
  "Assume you are evaluating whether this academic researcher is a strong candidate for further academic review, collaboration, or support in the context of the current search query.",
  "Summarize the person's relevance to the query, depth and breadth of research, recent citation-window impact, institutional or lab context, collaboration potential, and visible risks or data gaps.",
  "Use only the provided ranking/profile context. Do not invent facts, and do not mention any private sponsor or private business intent.",
  "End with a concise recommendation: strong candidate, worth reviewing, or lower priority, with the reason."
].join(" ");
const TOPIC_FALLBACK = ["Machine learning", "Computer vision", "Natural language processing", "Robotics", "AI in healthcare", "Post-quantum cryptography", "Quantum computing algorithms", "Materials informatics"];
const searchModeOptions: Array<{ value: SearchModeChoice; label: string; placeholder: string }> = [
  { value: "auto", label: "Default", placeholder: "Search researchers, topics, institutions..." },
  { value: "author", label: "Name", placeholder: "Search by researcher name..." },
  { value: "topic", label: "Query", placeholder: "Search by topic or keywords..." },
  { value: "institution", label: "Institution", placeholder: "Search by institution..." },
];
const YEAR_MIN = 1970;
const YEAR_MAX = 2026;
const defaultAppSettings: AppSettings = {
  theme: "dark",
  aiProvider: "gpt",
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-5.2",
  searchHistory: true,
  compactRows: false,
  interfaceScale: 100,
  localOnly: false,
  rememberApiKey: false,
  savedApiKeys: {},
  apiKeyStorageChoice: {},
};
const modelPresets: Record<ProviderKey, ModelPreset[]> = {
  gpt: [
    { label: "GPT-5.2", value: "gpt-5.2", description: "Newest flagship for complex reasoning, coding, and research synthesis." },
    { label: "GPT-5.2 Pro", value: "gpt-5.2-pro", description: "Highest-compute GPT-5.2 option for the hardest questions. Slower and more expensive." },
    { label: "GPT-5.2 Codex", value: "gpt-5.2-codex", description: "Coding-optimized GPT-5.2 variant for agentic coding workflows." },
    { label: "GPT-5.2 Chat", value: "gpt-5.2-chat-latest", description: "ChatGPT-style GPT-5.2 variant for conversational tasks." },
    { label: "GPT-5 mini", value: "gpt-5-mini", description: "Cost-efficient advanced model for everyday research chat." },
    { label: "GPT-5 nano", value: "gpt-5-nano", description: "Fastest low-cost GPT-5 option for simple summaries and classification." },
    { label: "GPT-5.1", value: "gpt-5.1", description: "Previous flagship, still strong for coding and agentic tasks." },
    { label: "GPT-5", value: "gpt-5", description: "Previous reasoning model across coding and general tasks." },
    { label: "GPT-4.1", value: "gpt-4.1", description: "Strong non-reasoning model with long context." },
    { label: "GPT-4.1 mini", value: "gpt-4.1-mini", description: "Fast and economical OpenAI chat model." },
    { label: "o3", value: "o3", description: "Older advanced reasoning model, useful for math/science style reasoning." },
  ],
  gemini: [
    { label: "Gemini 3 Pro Preview", value: "gemini-3-pro-preview", description: "Google's most intelligent Gemini model preview." },
    { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro", description: "Advanced thinking model for coding, math, STEM, and long context." },
    { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash", description: "Best price-performance Gemini model with thinking." },
    { label: "Gemini 2.5 Flash-Lite", value: "gemini-2.5-flash-lite", description: "Fastest cost-efficient Gemini option." },
    { label: "Gemini 2.0 Flash", value: "gemini-2.0-flash", description: "Stable older fast model with broad multimodal support." },
  ],
  claude: [
    { label: "Claude Opus 4.1", value: "claude-opus-4-1-20250805", description: "Anthropic's most capable Claude model for hard reasoning and coding." },
    { label: "Claude Opus 4", value: "claude-opus-4-20250514", description: "Powerful Claude 4 model for complex work." },
    { label: "Claude Sonnet 4", value: "claude-sonnet-4-20250514", description: "High-performance Claude model with strong reasoning and efficiency." },
    { label: "Claude Sonnet 3.7", value: "claude-3-7-sonnet-20250219", description: "Previous strong reasoning/coding Sonnet model." },
    { label: "Claude Haiku 3.5", value: "claude-3-5-haiku-20241022", description: "Fastest Claude option for lightweight chat." },
  ],
  custom: [
    { label: "DeepSeek Reasoner", value: "deepseek-reasoner", description: "Common OpenAI-compatible reasoning model ID, if your base URL supports it." },
    { label: "DeepSeek Chat", value: "deepseek-chat", description: "Common OpenAI-compatible chat model ID, if your base URL supports it." },
    { label: "Qwen Max", value: "qwen-max", description: "Common OpenAI-compatible Qwen model ID, if your base URL supports it." },
  ],
};
const defaultFilters: Filters = {
  weights: { query: 70, research: 30 },
  minYear: 2020,
  maxYear: YEAR_MAX,
  country: "All",
  pool: "pool",
  chartMode: "q-r",
  open: { saved: true, ranking: true, frontier: true, year: true, country: false, type: false },
};

const COUNTRY_CODE_LABELS: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  CN: "China",
  HK: "Hong Kong",
  TW: "Taiwan",
  JP: "Japan",
  KR: "South Korea",
  SG: "Singapore",
  AU: "Australia",
  NZ: "New Zealand",
  GB: "United Kingdom",
  UK: "United Kingdom",
  IE: "Ireland",
  FR: "France",
  DE: "Germany",
  IT: "Italy",
  ES: "Spain",
  PT: "Portugal",
  NL: "Netherlands",
  BE: "Belgium",
  CH: "Switzerland",
  AT: "Austria",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  PL: "Poland",
  CZ: "Czech Republic",
  GR: "Greece",
  IL: "Israel",
  IN: "India",
  MY: "Malaysia",
  TH: "Thailand",
  VN: "Vietnam",
  BR: "Brazil",
  MX: "Mexico",
  CL: "Chile",
  AR: "Argentina",
  ZA: "South Africa",
};

const COUNTRY_ALIASES: Record<string, string> = {
  "usa": "United States",
  "u s a": "United States",
  "united states of america": "United States",
  "uk": "United Kingdom",
  "u k": "United Kingdom",
  "england": "United Kingdom",
  "scotland": "United Kingdom",
  "wales": "United Kingdom",
  "northern ireland": "United Kingdom",
  "peoples republic of china": "China",
  "people s republic of china": "China",
  "south korea": "South Korea",
  "republic of korea": "South Korea",
};

const SUBNATIONAL_REGION_NAMES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia",
  "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland",
  "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire",
  "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania",
  "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington",
  "west virginia", "wisconsin", "wyoming", "district of columbia", "vaud", "wellington region", "ontario", "quebec",
  "british columbia", "new south wales", "victoria", "queensland", "western australia",
]);

const COUNTRY_LABELS = new Set([...Object.values(COUNTRY_CODE_LABELS), "Hong Kong", "Taiwan"]);

function readStoredSettings() {
  if (typeof window === "undefined") return defaultAppSettings;
  try {
    const raw = window.localStorage.getItem("research-ai-settings");
    if (!raw) return defaultAppSettings;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const merged = { ...defaultAppSettings, ...parsed } as AppSettings;
    const savedApiKeys = { ...(parsed.savedApiKeys || {}) } as AppSettings["savedApiKeys"];
    const apiKeyStorageChoice = { ...(parsed.apiKeyStorageChoice || {}) } as AppSettings["apiKeyStorageChoice"];
    if (typeof parsed.apiKey === "string" && parsed.apiKey.trim() && parsed.rememberApiKey) {
      savedApiKeys[merged.aiProvider] = parsed.apiKey.trim();
      apiKeyStorageChoice[merged.aiProvider] = "remember";
    }
    const rememberApiKey = apiKeyStorageChoice[merged.aiProvider] === "remember" || Boolean(savedApiKeys[merged.aiProvider]);
    return {
      ...merged,
      savedApiKeys,
      apiKeyStorageChoice,
      rememberApiKey,
      apiKey: rememberApiKey ? savedApiKeys[merged.aiProvider] || "" : "",
    };
  } catch {
    return defaultAppSettings;
  }
}

function persistSettings(settings: AppSettings) {
  if (typeof window === "undefined") return;
  const savedApiKeys = { ...settings.savedApiKeys };
  const currentKey = settings.apiKey.trim();
  if (settings.rememberApiKey && currentKey) savedApiKeys[settings.aiProvider] = currentKey;
  if (!settings.rememberApiKey) delete savedApiKeys[settings.aiProvider];
  const saved = { ...settings, savedApiKeys, apiKey: "" };
  window.localStorage.setItem("research-ai-settings", JSON.stringify(saved));
}

function readStoredSavedProfiles() {
  if (typeof window === "undefined") return {} as Record<string, ResearcherRecord>;
  try {
    const raw = window.localStorage.getItem(SAVED_PROFILE_STORAGE_KEY);
    if (!raw) return {} as Record<string, ResearcherRecord>;
    const parsed = JSON.parse(raw) as Record<string, ResearcherRecord>;
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value && typeof value.id === "string" && typeof value.name === "string")) as Record<string, ResearcherRecord>;
  } catch {
    return {} as Record<string, ResearcherRecord>;
  }
}

function persistSavedProfiles(savedProfiles: Record<string, ResearcherRecord>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SAVED_PROFILE_STORAGE_KEY, JSON.stringify(savedProfiles));
}

function normalizeCountryLabel(value?: string | null) {
  const raw = (value || "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (COUNTRY_CODE_LABELS[upper]) return COUNTRY_CODE_LABELS[upper];
  const normalized = normalizeIdentityText(raw);
  if (COUNTRY_ALIASES[normalized]) return COUNTRY_ALIASES[normalized];
  const byName = Array.from(COUNTRY_LABELS).find((country) => normalizeIdentityText(country) === normalized);
  if (byName) return byName;
  if (SUBNATIONAL_REGION_NAMES.has(normalized)) return "";
  return /^[A-Z]{2}$/.test(upper) ? upper : "";
}

function countryFromRankingResult(result: RankingApiResult) {
  return normalizeCountryLabel(result.country) || normalizeCountryLabel(result.country_code) || normalizeCountryLabel(result.countryCode) || normalizeCountryLabel(result.region);
}

function formatNumber(value: number) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return value.toLocaleString();
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function normalizeIdentityText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function identityTokens(value: string) {
  return normalizeIdentityText(value).split(/\s+/).filter((token) => token.length > 1);
}

function researcherNameMatchScore(researcher: ResearcherRecord, query: string) {
  const normalizedQuery = normalizeIdentityText(query);
  if (!normalizedQuery) return 0;
  const normalizedName = normalizeIdentityText(researcher.name);
  const tokens = identityTokens(query);
  const nameTokens = new Set(identityTokens(researcher.name));
  if (tokens.length === 0) return 0;
  if (normalizedName === normalizedQuery) return 1000000;
  if (tokens.length > 1 && tokens.every((token) => nameTokens.has(token))) return 900000;
  if (tokens.length === 1 && tokens[0].length >= 3 && nameTokens.has(tokens[0])) return 500000;
  if (tokens.length > 1 && normalizedQuery.length >= 4 && normalizedName.includes(normalizedQuery)) return 700000;
  return 0;
}

function googleResearcherUrl(researcher: ResearcherRecord) {
  return researcher.googleUrl || `https://www.google.com/search?q=${encodeURIComponent(`${researcher.name} ${researcher.institution}`)}`;
}

function googleScholarUrl(researcher: ResearcherRecord) {
  return researcher.scholarUrl || `https://scholar.google.com/scholar?q=${encodeURIComponent(`${researcher.name} ${researcher.primaryTopic}`)}`;
}

function researcherAiPrompt(researcher: ResearcherRecord, query: string) {
  const affiliation = affiliationDisplay(researcher);
  return [
    DEFAULT_INVESTMENT_PROMPT,
    "",
    `Focus on this researcher: ${researcher.name}.`,
    `Current query: ${query || "not specified"}.`,
    `Visible profile: institution=${affiliation.primary}; topic=${researcher.primaryTopic}; Q_norm=${Math.round(researcher.queryRelevanceNorm || 0)}; R_raw=${researcher.recentCitations || 0}; R_norm=${Math.round(researcher.recentCitationImpactNorm || 0)}; profile-only H-index=${researcher.hIndex}; lifetime citations=${researcher.totalCitations}; works=${researcher.totalWorks}.`,
  ].join("\n");
}

function matchSourceLabel(source?: ResearcherRecord["matchSource"]) {
  if (source === "exact-name") return "Exact name";
  if (source === "author-search") return "Author search";
  if (source === "institution-search") return "Institution search";
  if (source === "works-search") return "Works search";
  if (source === "topic-relevance") return "Query relevance";
  return "Backend match";
}

function sameInstitutionLabel(a?: string, b?: string) {
  const left = normalizeIdentityText(a || "");
  const right = normalizeIdentityText(b || "");
  return Boolean(left && right && left === right);
}

function affiliationDisplay(researcher: ResearcherRecord) {
  const matched = researcher.matchedInstitution || (researcher.searchMode === "institution" ? researcher.institution : "");
  const current = researcher.currentInstitution || "";
  const primary = matched || researcher.institution;
  const currentDiffers = Boolean(current && primary && !sameInstitutionLabel(current, primary));
  const note =
    researcher.searchMode === "institution"
      ? currentDiffers
        ? `Matched affiliation · Current: ${current}`
        : "Matched affiliation"
      : "";
  return {
    primary,
    note,
    country: researcher.matchedInstitutionCountry || researcher.country || researcher.currentInstitutionCountry || "",
    current,
    currentDiffers,
  };
}

function AffiliationSummary({ researcher, className = "", noteClassName = "text-[11px] text-cyan-300" }: { researcher: ResearcherRecord; className?: string; noteClassName?: string }) {
  const affiliation = affiliationDisplay(researcher);
  return (
    <div className={cn("min-w-0", className)}>
      <div className="truncate" title={affiliation.primary}>{affiliation.primary}</div>
      {affiliation.note && <div className={cn("truncate", noteClassName)} title={affiliation.note}>{affiliation.note}</div>}
    </div>
  );
}

function metricDescription(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes("query relevance") || normalized.includes("q relevance") || normalized === "q" || normalized.includes("q_norm")) return "Q_norm: backend query relevance scaled to 0-100. Higher means this author matched the search intent more strongly.";
  if (normalized.includes("research impact") || normalized.includes("r impact") || normalized === "r" || normalized.includes("r_norm") || normalized.includes("recent citation")) return "R_raw is citations received by matched papers during the selected citation year range. R_norm uses log(1 + R_raw), then normalizes within the result set.";
  if (normalized.includes("final")) return "Final Score = wQ * Q_norm + wR * R_norm. H-index is shown as profile context only.";
  if (normalized.includes("h-index") || normalized.includes("h profile") || normalized === "h") return "Profile-only h-index from the backend profile data. H=81 means the author has at least 81 works that each received at least 81 citations; it is not used in the default Q/R ranking.";
  if (normalized.includes("raw citation")) return "Total citation count from the backend profile data. This favors older and high-citation fields, so it is shown as context rather than used directly.";
  if (normalized.includes("citation")) return "Citation signal from the backend ranking data. The main ranking uses R for citation-window impact, not lifetime citations.";
  return "";
}

function tableSortValue(researcher: ResearcherRecord, key: TableSortKey) {
  if (key === "query") return researcher.queryRelevanceNorm || 0;
  if (key === "hIndex") return researcher.hIndex;
  if (key === "recentCitations") return researcher.recentCitations || 0;
  return 0;
}

function paperUrl(paper: { id: string; title: string }) {
  if ("url" in paper && typeof paper.url === "string" && paper.url) return paper.url;
  if (paper.id.startsWith("10.")) return `https://doi.org/${paper.id}`;
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`;
}

function researcherContext(list: ResearcherRecord[]) {
  return list.slice(0, 12).map((researcher, index) => {
    const affiliation = affiliationDisplay(researcher);
    const current = affiliation.currentDiffers ? `; current institution: ${affiliation.current}` : "";
    return `${index + 1}. ${researcher.name}; institution: ${affiliation.primary}${current}; topic: ${researcher.primaryTopic}; Q_norm: ${Math.round(researcher.queryRelevanceNorm || 0)}; R_raw citation-window citations: ${researcher.recentCitations || 0}; R_norm: ${Math.round(researcher.recentCitationImpactNorm || 0)}; final score: ${Math.round(researcher.finalScore || 0)}; profile-only H-index: ${researcher.hIndex}; lifetime citations: ${researcher.totalCitations}; works: ${researcher.totalWorks}`;
  }).join("\n");
}

async function requestAiAnswer(settings: AppSettings, messages: ChatMessage[], context?: string) {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: settings.aiProvider,
      apiBaseUrl: settings.apiBaseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      messages,
      context,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `AI request failed with HTTP ${response.status}.`);
  if (!data.answer) throw new Error("AI response did not include an answer.");
  return data.answer as string;
}

async function apiRequest<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed with HTTP ${response.status}.`);
  return data as T;
}

function finiteNumber(value: unknown, fallback: unknown = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
  if (typeof fallback === "string" && fallback.trim()) {
    const parsed = Number(fallback);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function percentFromUnit(value: unknown, fallback = 0) {
  const numeric = finiteNumber(value, fallback);
  if (numeric <= 1) return Math.max(0, numeric * 100);
  return Math.max(0, numeric);
}

function componentNumber(components: Record<string, unknown> | undefined, keys: string[], fallback: unknown = 0) {
  for (const key of keys) {
    if (components && key in components) return finiteNumber(components[key], fallback);
  }
  return finiteNumber(fallback, 0);
}

function rankingPaperId(paper: RankingTopPaper, index: number) {
  return (paper.paper_id || `ranking-paper-${index}`).trim();
}

function rankingPapers(result: RankingApiResult): ResearchPaper[] {
  const seen = new Set<string>();
  const papers = [...(result.reason?.top_papers || []), ...(result.contribution?.paper_contributions || [])];
  return papers.flatMap((paper, index) => {
    const title = (paper.title || "Matched paper").trim();
    const id = rankingPaperId(paper, index);
    const key = `${id}-${title}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      id,
      title,
      year: finiteNumber(paper.year, 0),
      venue: "Ranking backend",
      venueType: "matched paper",
      citations: 0,
      recentCitations: 0,
      concept: result.reason?.primary_driver || "Matched paper",
      abstract: paper.similarity != null ? `Similarity: ${finiteNumber(paper.similarity).toFixed(3)}` : "",
      url: id.startsWith("10.") ? `https://doi.org/${id}` : undefined,
    }];
  });
}

function mapRankingResult(result: RankingApiResult, index: number, query: string, searchMode: SearchModeChoice, citationStartYear: number, citationEndYear: number): ResearcherRecord {
  const components = result.components || {};
  const name = (result.name || `Researcher ${index + 1}`).trim();
  const papers = rankingPapers(result);
  const topPaper = papers[0];
  const hIndex = componentNumber(components, ["h_index", "hIndex"], percentFromUnit(result.H));
  const totalCitations = componentNumber(components, ["total_citations", "totalCitations", "lifetime_citations"], 0);
  const rValue = finiteNumber(result.R, 0);
  const recentCitations = componentNumber(components, ["R_raw", "r_raw", "recent_citations", "recentCitations", "citation_window_citations"], rValue > 1 ? rValue : 0);
  const qRaw = finiteNumber(result.Q, 0);
  const rNorm = percentFromUnit(componentNumber(components, ["R_norm", "r_norm"], rValue));
  const finalScore = percentFromUnit(result.final_score, 0);
  const matchSource: ResearcherRecord["matchSource"] =
    searchMode === "author" ? "author-search" :
    searchMode === "institution" ? "institution-search" :
    "topic-relevance";
  const primaryTopic = result.reason?.highlights?.[0] || topPaper?.title || "Backend-ranked match";
  const matchedPaperCount = finiteNumber(result.contribution?.matched_paper_count, papers.length);
  const startYear = papers.map((paper) => paper.year).filter(Boolean).sort((a, b) => a - b)[0] || YEAR_MAX;
  const institution = result.institution || "Unknown institution";
  const region = result.region || "";
  const country = countryFromRankingResult(result);
  return {
    id: result.researcher_id || `ranking-${index}-${normalizeIdentityText(name)}`,
    name,
    initials: initials(name),
    institution,
    institutionId: "",
    country: country || "Unknown",
    region,
    totalWorks: matchedPaperCount,
    totalCitations,
    recentCitations,
    citationStartYear,
    citationEndYear,
    hIndex,
    i10Index: 0,
    careerStartYear: startYear,
    yearsActive: Math.max(0, YEAR_MAX - startYear + 1),
    qScore: percentFromUnit(result.Q, 0),
    recencyScore: 0,
    compositeScore: finalScore,
    primaryTopic,
    topics: [primaryTopic, ...(result.reason?.highlights || [])].filter(Boolean).slice(0, 5),
    subfield: "",
    field: "",
    domain: "",
    authorUrl: result.researcher_id ? `https://openalex.org/${result.researcher_id}` : undefined,
    googleUrl: `https://www.google.com/search?q=${encodeURIComponent(`${name} ${institution}`)}`,
    scholarUrl: `https://scholar.google.com/scholar?q=${encodeURIComponent(`${name} ${query}`)}`,
    papers,
    collaborators: [],
    relevanceScore: qRaw,
    queryRelevanceScore: qRaw,
    queryRelevanceNorm: percentFromUnit(result.Q, 0),
    recentCitationImpactNorm: rNorm,
    finalScore,
    whyMatched: result.reason?.summary || "Returned by the ranking backend for the current query.",
    matchSource,
    matchReason: result.reason?.summary || "Ranking backend match",
    searchMode: searchMode === "institution" ? "institution" : searchMode === "author" ? "author" : "topic",
    aiSummary: result.reason?.summary || "",
    topPapers: papers,
    researchThemes: result.reason?.highlights || [],
    relatedResearchers: [],
    publications: matchedPaperCount,
  };
}

function mapRankingResponse(response: RankingApiResponse, query: string, searchMode: SearchModeChoice, citationStartYear: number, citationEndYear: number): ResearchersResponse {
  const researchers = (response.results || []).map((result, index) => mapRankingResult(result, index, query, searchMode, citationStartYear, citationEndYear));
  return {
    query,
    meta: {
      resultCount: researchers.length,
      worksSampled: researchers.reduce((sum, researcher) => sum + researcher.papers.length, 0),
      researchers: researchers.length,
      searchMode: searchMode === "institution" ? "institution" : searchMode === "author" ? "author" : "topic",
      sourceLabel: "Ranking backend",
      citationStartYear,
      citationEndYear,
    },
    researchers,
  };
}

async function fetchRankingResearchers(query: string, searchMode: SearchModeChoice, citationStartYear: number, citationEndYear: number, weights: Record<WeightKey, number>, signal: AbortSignal) {
  const searchFields =
    searchMode === "author" ? { search_type: "author", author_query: query } :
    searchMode === "institution" ? { search_type: "institution", institution_query: query } :
    searchMode === "topic" ? { search_type: "topic", topic_query: query } :
    { search_type: "default" };
  const response = await apiRequest<RankingApiResponse>("/api/ranking/rank", {
    method: "POST",
    signal,
    body: JSON.stringify({
      query,
      ...searchFields,
      limit: RESULT_LIMIT,
      top_k: RESULT_LIMIT,
      use_simple_ranking: true,
      q_weight: weights.query,
      r_weight: weights.research,
      citation_start_year: citationStartYear,
      citation_end_year: citationEndYear,
    }),
  });
  const mapped = mapRankingResponse(response, query, searchMode, citationStartYear, citationEndYear);
  if (mapped.researchers.length === 0) throw new Error("Ranking backend returned no researchers.");
  return mapped;
}

function normalizedMetricMap(list: ResearcherRecord[], valueFor: (researcher: ResearcherRecord) => number, logScale = false) {
  const values = list.map((researcher) => {
    const raw = Math.max(0, valueFor(researcher));
    return [researcher.id, logScale ? Math.log1p(raw) : raw] as const;
  });
  const numericValues = values.map(([, value]) => value);
  const min = Math.min(...numericValues, 0);
  const max = Math.max(...numericValues, 0);
  return new Map(values.map(([id, value]) => [id, max <= min ? (max > 0 ? 100 : 0) : ((value - min) / (max - min)) * 100]));
}

function finalRankingScore(qNorm: number, rNorm: number, weights: Record<WeightKey, number>) {
  const total = weights.query + weights.research;
  if (total <= 0) return 0;
  return (qNorm * weights.query + rNorm * weights.research) / total;
}

function rankingWeightShares(weights: Record<WeightKey, number>) {
  const total = weights.query + weights.research;
  if (total <= 0) return { query: 0, research: 0 };
  return {
    query: weights.query / total,
    research: weights.research / total,
  };
}

function paretoIds(list: ResearcherRecord[]) {
  const ids = new Set<string>();
  for (const candidate of list) {
    const candidateQ = candidate.queryRelevanceNorm || 0;
    const candidateR = candidate.recentCitationImpactNorm || 0;
    const dominated = list.some((other) => other.id !== candidate.id && (other.queryRelevanceNorm || 0) >= candidateQ && (other.recentCitationImpactNorm || 0) >= candidateR && ((other.queryRelevanceNorm || 0) > candidateQ || (other.recentCitationImpactNorm || 0) > candidateR));
    if (!dominated) ids.add(candidate.id);
  }
  return ids;
}

function Section({ id, title, filters, setFilters, children }: { id: string; title: string; filters: Filters; setFilters: (filters: Filters) => void; children: React.ReactNode }) {
  const open = filters.open[id];
  return (
    <section className="border-b border-white/8 pb-3">
      <button className="flex w-full items-center justify-between py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-300" onClick={() => setFilters({ ...filters, open: { ...filters.open, [id]: !open } })}>
        {title}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && children}
    </section>
  );
}

function WeightSlider({ label, color, value, onChange }: { label: string; color: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] text-slate-400">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</span>
        <span className="font-mono text-slate-200">{value}%</span>
      </div>
      <input className="h-1.5 w-full accent-blue-500" type="range" min={0} max={100} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}

function YearRangeSlider({ filters, setFilters }: { filters: Filters; setFilters: (filters: Filters) => void }) {
  const minPercent = ((filters.minYear - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100;
  const maxPercent = ((filters.maxYear - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100;
  const updateMin = (value: number) => setFilters({ ...filters, minYear: Math.min(value, filters.maxYear - 1) });
  const updateMax = (value: number) => setFilters({ ...filters, maxYear: Math.max(value, filters.minYear + 1) });

  return (
    <div className="space-y-3">
      <div className="flex justify-between text-[10px] text-slate-500"><span>Citation Year Range: {filters.minYear}</span><span>{filters.maxYear}</span></div>
      <div className="relative h-8">
        <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/15" />
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-blue-500" style={{ left: `${minPercent}%`, right: `${100 - maxPercent}%` }} />
        <input aria-label="Minimum citation year" type="range" min={YEAR_MIN} max={YEAR_MAX} value={filters.minYear} className="year-range-input absolute inset-0 z-20 w-full" onChange={(event) => updateMin(Number(event.target.value))} />
        <input aria-label="Maximum citation year" type="range" min={YEAR_MIN} max={YEAR_MAX} value={filters.maxYear} className="year-range-input absolute inset-0 z-30 w-full" onChange={(event) => updateMax(Number(event.target.value))} />
      </div>
      <p className="text-[10px] leading-4 text-slate-500">Counts citations received during this window, not publication years.</p>
    </div>
  );
}

function TopActions({ user, onLogout, onOpenSettings, onOpenAuth }: { user?: CurrentUser; onLogout: () => void; onOpenSettings: () => void; onOpenAuth: (mode: AuthMode) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={onOpenSettings} className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/[0.06] hover:text-slate-100"><Settings className="mr-1 inline h-3.5 w-3.5" />Settings</button>
      {user ? (
        <>
          <span className="max-w-[160px] truncate text-xs text-slate-400"><User className="mr-1 inline h-3.5 w-3.5" />{user.identifier}</span>
          <button onClick={onLogout} className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/[0.06] hover:text-slate-100">Log out</button>
        </>
      ) : (
        <>
          <button onClick={() => onOpenAuth("login")} className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/[0.06] hover:text-slate-100"><User className="mr-1 inline h-3.5 w-3.5" />Log in</button>
          <button onClick={() => onOpenAuth("register")} className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500">Sign up</button>
        </>
      )}
    </div>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={cn("relative inline-flex items-center justify-center rounded-md bg-blue-600 text-white shadow-[0_0_24px_rgba(37,99,235,.24)]", compact ? "h-7 w-7" : "h-10 w-10")}>
      <Search className={cn(compact ? "h-3.5 w-3.5" : "h-5 w-5")} />
      <Sparkles className={cn("absolute -right-1 -top-1 rounded-full bg-cyan-400 p-0.5 text-slate-950", compact ? "h-3 w-3" : "h-4 w-4")} />
    </span>
  );
}

function TeamCredit({ className = "" }: { className?: string }) {
  return <div className={cn("text-[10px] leading-5 text-slate-600", className)}>{TEAM_CREDIT} · Suggested domain: {BRAND_DOMAIN}</div>;
}

function providerDefaults(provider: AppSettings["aiProvider"]) {
  if (provider === "claude") return { apiBaseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-20250514" };
  if (provider === "gemini") return { apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash" };
  if (provider === "custom") return { apiBaseUrl: "https://api.openai.com/v1", model: "" };
  return { apiBaseUrl: "https://api.openai.com/v1", model: "gpt-5.2" };
}

function SettingsModal({ open, settings, user, accountAiSettings, accountAiSaving, onClose, onChange, onSaveAccountAi, onClearAccountAi }: { open: boolean; settings: AppSettings; user?: CurrentUser; accountAiSettings?: AccountAiSettings; accountAiSaving: boolean; onClose: () => void; onChange: (settings: AppSettings) => void; onSaveAccountAi: () => void; onClearAccountAi: () => void }) {
  if (!open) return null;
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => onChange({ ...settings, [key]: value });
  const providerChoice = settings.apiKeyStorageChoice[settings.aiProvider];
  const storedKey = settings.savedApiKeys[settings.aiProvider];
  const presets = modelPresets[settings.aiProvider] || [];
  const selectedPreset = presets.find((preset) => preset.value && preset.value === settings.model);
  const setStorageChoice = (choice: ApiKeyStorageChoice) => {
    const savedApiKeys = { ...settings.savedApiKeys };
    const apiKeyStorageChoice = { ...settings.apiKeyStorageChoice, [settings.aiProvider]: choice };
    if (choice === "remember" && settings.apiKey.trim()) savedApiKeys[settings.aiProvider] = settings.apiKey.trim();
    if (choice === "forget") delete savedApiKeys[settings.aiProvider];
    onChange({ ...settings, rememberApiKey: choice === "remember", savedApiKeys, apiKeyStorageChoice });
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="max-h-[86vh] w-full max-w-[760px] overflow-y-auto rounded-lg border border-white/10 bg-[#080c14] p-5 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div><h2 className="text-lg font-bold text-slate-100">Settings</h2><p className="text-sm text-slate-500">Tune AI, appearance, search, and local data behavior.</p></div>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-white/8 hover:text-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-lg border border-white/8 bg-white/[0.025] p-4">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-300">AI API</h3>
            <p className="mb-3 text-xs leading-5 text-slate-500">AI can use a server default key, an account-saved key, or a temporary key pasted here.</p>
            <label className="text-xs text-slate-500">Provider</label>
            <select value={settings.aiProvider} onChange={(event) => { const provider = event.target.value as AppSettings["aiProvider"]; const defaults = providerDefaults(provider); onChange({ ...settings, aiProvider: provider, apiBaseUrl: defaults.apiBaseUrl, model: defaults.model, apiKey: settings.savedApiKeys[provider] || "", rememberApiKey: Boolean(settings.savedApiKeys[provider]) }); }} className="mt-1 w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none">
              <option value="gpt">GPT / OpenAI compatible</option>
              <option value="gemini">Gemini</option>
              <option value="claude">Claude / Anthropic</option>
              <option value="custom">Custom endpoint</option>
            </select>
            <label className="mt-3 block text-xs text-slate-500">API base URL</label>
            <input value={settings.apiBaseUrl} onChange={(event) => set("apiBaseUrl", event.target.value)} className="mt-1 w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none" />
            <label className="mt-3 block text-xs text-slate-500">API key</label>
            <input
              value={settings.apiKey}
              onChange={(event) => {
                const apiKey = event.target.value;
                const savedApiKeys = { ...settings.savedApiKeys };
                if (settings.rememberApiKey) {
                  if (apiKey.trim()) savedApiKeys[settings.aiProvider] = apiKey.trim();
                  else delete savedApiKeys[settings.aiProvider];
                }
                onChange({ ...settings, apiKey, savedApiKeys });
              }}
              type="password"
              placeholder="Paste your own provider key"
              className="mt-1 w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600"
            />
            {settings.apiKey.trim() && !providerChoice ? (
              <div className="mt-3 rounded-md border border-blue-500/20 bg-blue-500/10 p-3">
                <p className="text-xs leading-5 text-slate-300">Remember this {settings.aiProvider.toUpperCase()} key on this device?</p>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setStorageChoice("remember")} className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500">Remember on this device</button>
                  <button onClick={() => setStorageChoice("forget")} className="rounded-md border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/[0.04]">Do not store</button>
                </div>
              </div>
            ) : (
              <>
                <label className="mt-3 flex items-center justify-between rounded-md border border-white/8 px-3 py-3 text-sm text-slate-300"><span>Remember key on this device</span><input type="checkbox" checked={settings.rememberApiKey} onChange={(event) => setStorageChoice(event.target.checked ? "remember" : "forget")} /></label>
                <p className="mt-2 text-xs leading-5 text-slate-500">{storedKey ? "This provider key is stored only in this browser on this device." : "Your key is used only for live AI requests unless you choose to save it on this device."}</p>
              </>
            )}
            <div className="mt-3 rounded-md border border-white/8 bg-black/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-200">Account AI settings</div>
                  <p className="mt-1 text-[11px] leading-5 text-slate-500">
                    {user ? accountAiSettings?.hasApiKey ? "An encrypted API key is saved to your account." : "Save a key to your account so AI works across devices." : "Log in to save AI settings to your account."}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button disabled={!user || accountAiSaving} onClick={onSaveAccountAi} className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-45">Save</button>
                  {accountAiSettings?.hasApiKey && <button disabled={!user || accountAiSaving} onClick={onClearAccountAi} className="rounded-md border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/[0.04] disabled:opacity-45">Clear key</button>}
                </div>
              </div>
              {accountAiSettings && <p className="mt-2 text-[10px] text-slate-600">Account model: {accountAiSettings.model || "default"} · provider: {accountAiSettings.provider}</p>}
            </div>
            <label className="mt-3 block text-xs text-slate-500">Model preset</label>
            <select
              value={selectedPreset?.value || "__custom"}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "__custom") return;
                set("model", value);
              }}
              className="mt-1 w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none"
            >
              {!selectedPreset && <option value="__custom">Custom model ID</option>}
              {presets.map((preset) => (
                <option key={preset.label} value={preset.value || "__custom"}>{preset.label}{preset.value ? ` - ${preset.value}` : ""}</option>
              ))}
            </select>
            <p className="mt-2 text-xs leading-5 text-slate-500">{selectedPreset?.description || "Choose a preset above, or enter the exact model ID supported by your API endpoint."}</p>
            <label className="mt-3 block text-xs text-slate-500">Model ID</label>
            <input value={settings.model} onChange={(event) => set("model", event.target.value)} placeholder={settings.aiProvider === "custom" ? "e.g. deepseek-reasoner" : "Exact model ID"} className="mt-1 w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
          </section>
          <section className="rounded-lg border border-white/8 bg-white/[0.025] p-4">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-300">Appearance</h3>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => set("theme", "dark")} className={cn("rounded-md border px-3 py-3 text-sm", settings.theme === "dark" ? "border-blue-500/50 bg-blue-500/15 text-blue-100" : "border-white/10 text-slate-400")}><Moon className="mr-1 inline h-4 w-4" />Dark</button>
              <button onClick={() => set("theme", "light")} className={cn("rounded-md border px-3 py-3 text-sm", settings.theme === "light" ? "border-blue-500/50 bg-blue-500/15 text-blue-100" : "border-white/10 text-slate-400")}><Sun className="mr-1 inline h-4 w-4" />Light</button>
            </div>
            <div className="mt-4 rounded-md border border-white/8 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-300">Interface scale</div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Shrink on laptop screens, enlarge on large monitors.</p>
                </div>
                <span className="font-mono text-sm font-bold text-blue-200">{settings.interfaceScale}%</span>
              </div>
              <input
                className="mt-3 h-1.5 w-full accent-blue-500"
                type="range"
                min={80}
                max={125}
                step={5}
                value={settings.interfaceScale}
                onChange={(event) => set("interfaceScale", Number(event.target.value))}
              />
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[["Laptop", 90], ["Default", 100], ["Large", 115]].map(([label, value]) => (
                  <button key={label as string} onClick={() => set("interfaceScale", value as number)} className={cn("rounded border px-2 py-1.5 text-xs", settings.interfaceScale === value ? "border-blue-500/60 bg-blue-500/15 text-blue-100" : "border-white/8 text-slate-500 hover:text-slate-200")}>{label as string}</button>
                ))}
              </div>
            </div>
            <label className="mt-4 flex items-center justify-between rounded-md border border-white/8 px-3 py-3 text-sm text-slate-300"><span>Compact table rows</span><input type="checkbox" checked={settings.compactRows} onChange={(event) => set("compactRows", event.target.checked)} /></label>
          </section>
          <section className="rounded-lg border border-white/8 bg-white/[0.025] p-4">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-300">Search</h3>
            <label className="flex items-center justify-between rounded-md border border-white/8 px-3 py-3 text-sm text-slate-300"><span>Save search history</span><input type="checkbox" checked={settings.searchHistory} onChange={(event) => set("searchHistory", event.target.checked)} /></label>
            <p className="mt-3 text-xs leading-5 text-slate-500">History stays in this browser session and powers the search dropdown.</p>
          </section>
          <section className="rounded-lg border border-white/8 bg-white/[0.025] p-4">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-300">Data & Privacy</h3>
            <div className="rounded-md border border-white/8 px-3 py-3 text-sm text-slate-300">Ranking backend via same-app proxy</div>
            <p className="mt-3 text-xs leading-5 text-slate-500">Search results are fetched from the shared ranking backend so the interface uses the same persistent researcher data as the backend service.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

function AuthModal({ mode, onClose, onModeChange, onAuthenticated }: { mode?: AuthMode; onClose: () => void; onModeChange: (mode: AuthMode) => void; onAuthenticated: (user: CurrentUser) => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  if (!mode) return null;
  const title = mode === "login" ? "Log in" : "Create account";
  const googleLoginEnabled = import.meta.env.VITE_GOOGLE_LOGIN_ENABLED === "true";
  const requestCode = async () => {
    setLoading(true);
    try {
      const result = await apiRequest<{ devCode?: string; message?: string }>("/api/auth/request-code", { method: "POST", body: JSON.stringify({ identifier }) });
      setStatus(result.devCode ? `Verification code: ${result.devCode}` : result.message || "Verification code sent.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };
  const submit = async () => {
    setLoading(true);
    try {
      const url = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const result = await apiRequest<{ user: CurrentUser }>(url, { method: "POST", body: JSON.stringify({ identifier, password, code }) });
      onAuthenticated(result.user);
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-[420px] rounded-lg border border-white/10 bg-[#080c14] p-5 shadow-2xl">
        <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-bold text-slate-100">{title}</h2><button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-white/8 hover:text-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="grid grid-cols-2 gap-2 rounded-md bg-black/20 p-1">
          <button onClick={() => onModeChange("login")} className={cn("rounded px-3 py-2 text-sm", mode === "login" ? "bg-blue-600 text-white" : "text-slate-400")}>Log in</button>
          <button onClick={() => onModeChange("register")} className={cn("rounded px-3 py-2 text-sm", mode === "register" ? "bg-blue-600 text-white" : "text-slate-400")}>Register</button>
        </div>
        {googleLoginEnabled ? (
          <a href="/api/auth/google/start" className="mt-4 block w-full rounded-md border border-white/10 px-3 py-2.5 text-center text-sm font-semibold text-slate-200 hover:bg-white/[0.04]">Continue with Google</a>
        ) : (
          <button type="button" onClick={() => setStatus("Google sign-in is wired in the backend, but needs Google OAuth credentials and VITE_GOOGLE_LOGIN_ENABLED=true before it is shown as live.")} className="mt-4 block w-full rounded-md border border-white/10 px-3 py-2.5 text-center text-sm font-semibold text-slate-400 hover:bg-white/[0.04]">Continue with Google</button>
        )}
        <div className="my-4 flex items-center gap-3 text-xs text-slate-600"><span className="h-px flex-1 bg-white/10" />or<span className="h-px flex-1 bg-white/10" /></div>
        <label className="text-xs text-slate-500"><Mail className="mr-1 inline h-3.5 w-3.5" /><Phone className="mr-1 inline h-3.5 w-3.5" />Email or phone</label>
        <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} className="mt-1 w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600" placeholder="name@example.com or +1 555 000 0000" />
        {mode === "register" && (
          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <input value={code} onChange={(event) => setCode(event.target.value)} className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600" placeholder="Verification code" />
            <button disabled={loading} onClick={requestCode} className="rounded-md border border-blue-500/40 px-3 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-500/10 disabled:opacity-50">Send code</button>
          </div>
        )}
        <label className="mt-3 block text-xs text-slate-500">Password</label>
        <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" className="mt-1 w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600" placeholder="Password" />
        {status && <p className="mt-3 rounded-md border border-white/8 bg-black/20 px-3 py-2 text-xs text-slate-400">{status}</p>}
        <button disabled={loading} onClick={submit} className="mt-5 w-full rounded-md bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">{loading ? "Working..." : mode === "login" ? "Log in" : "Create account"}</button>
      </div>
    </div>
  );
}

function SearchInputWithHistory({
  query,
  setQuery,
  onSearch,
  history,
  searchMode,
  setSearchMode,
  compact = false,
}: {
  query: string;
  setQuery: (query: string) => void;
  onSearch: (query?: string) => void;
  history: string[];
  searchMode: SearchModeChoice;
  setSearchMode: (mode: SearchModeChoice) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const matches = history.filter((item) => item.toLowerCase().includes(query.toLowerCase()) || query.trim() === "").slice(0, 8);
  const activeMode = searchModeOptions.find((option) => option.value === searchMode) || searchModeOptions[0];
  return (
    <div className={cn("relative", compact ? "flex max-w-[760px] flex-1" : "w-full")}>
      <div className={cn("flex w-full items-center gap-3 border border-white/10 bg-white/[0.03] focus-within:border-blue-500/70", compact ? "rounded-full bg-black/20 px-3 py-2" : "rounded-full px-4 py-3")}>
        <select
          aria-label="Search mode"
          value={searchMode}
          onChange={(event) => setSearchMode(event.target.value as SearchModeChoice)}
          className={cn("shrink-0 border-r border-white/10 bg-transparent pr-2 text-xs font-semibold text-slate-300 outline-none", compact ? "w-[96px]" : "w-[118px]")}
        >
          {searchModeOptions.map((option) => (
            <option key={option.value} value={option.value} className="bg-[#0b1018] text-slate-100">
              {option.label}
            </option>
          ))}
        </select>
        <Search className="h-4 w-4 shrink-0 text-slate-500" />
        <input
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setOpen(false);
              onSearch();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600"
          placeholder={activeMode.placeholder}
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-lg border border-white/10 bg-[#0b1018] shadow-2xl">
          <div className="border-b border-white/8 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Search History</div>
          {matches.map((item) => (
            <button
              key={item}
              onMouseDown={(event) => {
                event.preventDefault();
                setQuery(item);
                setOpen(false);
                onSearch(item);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-400 hover:bg-white/[0.04] hover:text-slate-100"
            >
              <Search className="h-3 w-3 text-slate-600" />
              <span className="truncate">{item}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatFloatingButton({ query, settings }: { query: string; settings: AppSettings }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState<FloatingPosition>(() => ({ x: typeof window === "undefined" ? 28 : Math.max(12, window.innerWidth - 84), y: typeof window === "undefined" ? 28 : Math.max(12, window.innerHeight - 84) }));
  const [dragging, setDragging] = useState(false);
  const [dragMoved, setDragMoved] = useState(false);
  const [dragStart, setDragStart] = useState<FloatingPosition>({ x: 0, y: 0 });
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Hi, I can help turn a rough research idea into better search terms, compare fields, or prepare a shortlist." },
  ]);
  const send = async () => {
    const text = draft.trim();
    if (!text || loading) return;
    const nextMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(nextMessages);
    setDraft("");
    setLoading(true);
    try {
      const answer = await requestAiAnswer(settings, nextMessages, `The current search box contains: ${query || "empty"}.`);
      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch (error) {
      setMessages((prev) => [...prev, { role: "assistant", content: error instanceof Error ? error.message : String(error) }]);
    } finally {
      setLoading(false);
    }
  };
  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    setDragging(true);
    setDragMoved(false);
    setDragStart({ x: event.clientX - position.x, y: event.clientY - position.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const drag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    const margin = 12;
    const maxX = window.innerWidth - 72;
    const maxY = window.innerHeight - 72;
    const next = { x: Math.min(Math.max(event.clientX - dragStart.x, margin), maxX), y: Math.min(Math.max(event.clientY - dragStart.y, margin), maxY) };
    if (Math.abs(next.x - position.x) > 2 || Math.abs(next.y - position.y) > 2) setDragMoved(true);
    setPosition(next);
  };
  const stopDrag = () => setDragging(false);
  return (
    <div className="fixed z-50" style={{ left: position.x, top: position.y }}>
      {open && (
        <div className="absolute bottom-16 right-0 flex h-[min(var(--floating-chat-height),calc(100vh-120px))] w-[min(var(--floating-chat-width),calc(100vw-48px))] flex-col overflow-hidden rounded-lg border border-white/10 bg-[#080c14] shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-100"><Bot className="h-4 w-4 text-cyan-300" />Research Chat</div>
            <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-500 hover:bg-white/8 hover:text-slate-100"><X className="h-4 w-4" /></button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm">
            {messages.map((message, index) => (
              <div key={index} className={cn("max-w-[86%] rounded-lg px-3 py-2 leading-6", message.role === "user" ? "ml-auto bg-emerald-600 text-white" : "bg-white/[0.045] text-slate-300")}>{message.content}</div>
            ))}
            {loading && <div className="max-w-[86%] rounded-lg bg-white/[0.045] px-3 py-2 leading-6 text-slate-300">Thinking...</div>}
          </div>
          <div className="border-t border-white/8 p-3">
            <div className="flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2">
              <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && send()} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600" placeholder={`Ask about ${query || "a research topic"}...`} />
              <button disabled={loading} onClick={send} className="rounded bg-blue-600 p-2 text-white hover:bg-blue-500 disabled:opacity-50"><Send className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </div>
      )}
      <button onPointerDown={startDrag} onPointerMove={drag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onClick={() => { if (dragMoved) setDragMoved(false); else setOpen((value) => !value); }} className="flex h-14 w-14 touch-none items-center justify-center rounded-full border border-cyan-300/40 bg-blue-600 text-white shadow-[0_0_32px_rgba(59,130,246,.35)] hover:bg-blue-500">
        <MessageCircle className="h-6 w-6" />
      </button>
    </div>
  );
}

function ResultsAiPanel({ list, query, settings, researcher, autoRequest }: { list: ResearcherRecord[]; query: string; settings: AppSettings; researcher?: ResearcherRecord; autoRequest?: AiAutoRequest }) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const [customPrompt, setCustomPrompt] = useState(DEFAULT_INVESTMENT_PROMPT);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const handledAutoRequest = useRef<number | undefined>(undefined);
  const ask = async (override?: string) => {
    const text = (override ?? draft).trim();
    if (!text || loading) return;
    const nextMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(nextMessages);
    if (!override) setDraft("");
    setLoading(true);
    try {
      const answer = await requestAiAnswer(settings, nextMessages, [
        `Current search query: ${query}`,
        researcher ? `Currently highlighted researcher: ${researcher.name}; institution: ${affiliationDisplay(researcher).primary}; topic: ${researcher.primaryTopic}; Q_norm: ${Math.round(researcher.queryRelevanceNorm || 0)}; R_raw citation-window citations: ${researcher.recentCitations || 0}; R_norm: ${Math.round(researcher.recentCitationImpactNorm || 0)}; profile-only H-index: ${researcher.hIndex}; lifetime citations: ${researcher.totalCitations}.` : "",
        "Ordinal references such as 'the first person' or 'the second researcher' refer to the current visible page order below.",
        `Current visible researchers:\n${researcherContext(list)}`,
      ].filter(Boolean).join("\n\n"));
      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch (error) {
      setMessages((prev) => [...prev, { role: "assistant", content: error instanceof Error ? error.message : String(error) }]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!autoRequest || handledAutoRequest.current === autoRequest.id) return;
    handledAutoRequest.current = autoRequest.id;
    setOpen(true);
    setCustomPrompt(autoRequest.prompt);
    void ask(autoRequest.prompt);
  }, [autoRequest?.id]);
  return (
    <section className="rounded-lg border border-white/8 bg-white/[0.025]">
      <button onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-bold text-slate-100"><Bot className="h-4 w-4 text-cyan-300" />AI Search Assistant</span>
        <ChevronDown className={cn("h-4 w-4 text-slate-500 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-white/8">
          <div className="px-4 py-3 text-[11px] leading-5 text-slate-500">Ask about the selected researcher or visible ranks. For example: "Tell me about the first person."</div>
          <div className="border-t border-white/8 px-4 py-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-300">Default prompt</div>
            <textarea value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} className="h-28 w-full resize-none rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs leading-5 text-slate-300 outline-none placeholder:text-slate-600" />
            <button disabled={loading} onClick={() => ask(customPrompt)} className="mt-2 rounded-md border border-cyan-400/30 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-50">Run prompt</button>
          </div>
          <div className="flex min-h-[280px] flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 text-sm">
            {messages.length === 0 ? <p className="text-slate-500">Click the AI button beside a researcher, or ask directly: "Tell me about the first person."</p> : messages.map((message, index) => <div key={index} className={cn("max-w-[88%] rounded-lg px-3 py-2 leading-6", message.role === "user" ? "ml-auto bg-emerald-600 text-white" : "bg-black/20 text-slate-300")}>{message.content}</div>)}
            {loading && <div className="max-w-[88%] rounded-lg bg-black/20 px-3 py-2 leading-6 text-slate-300">Thinking...</div>}
          </div>
          <div className="flex items-center gap-2 border-t border-white/8 p-4">
            <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && ask()} className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none placeholder:text-slate-600" placeholder="Ask AI about these results..." />
            <button disabled={loading} onClick={() => ask()} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">Send</button>
          </div>
        </div>
        </div>
      )}
    </section>
  );
}

function uniqueShortlist(items: Array<{ researcher?: ResearcherRecord; label: string; reason: string }>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.researcher || seen.has(item.researcher.id)) return false;
    seen.add(item.researcher.id);
    return true;
  }).slice(0, 3) as Array<{ researcher: ResearcherRecord; label: string; reason: string }>;
}

function AutoAnalysisPanel({ list, query, loading, searchMode }: { list: ResearcherRecord[]; query: string; loading: boolean; searchMode?: SearchMeta["searchMode"] }) {
  if (loading) {
    return <section className="border-b border-white/8 bg-[#070a10] px-4 py-3 text-xs text-slate-500">Preparing automatic research brief...</section>;
  }
  if (list.length === 0) return null;
  const top = list[0];
  const sortedByQuery = [...list].sort((a, b) => (b.queryRelevanceNorm || 0) - (a.queryRelevanceNorm || 0));
  const sortedByImpact = [...list].sort((a, b) => (b.recentCitationImpactNorm || 0) - (a.recentCitationImpactNorm || 0));
  const bestQuery = sortedByQuery[0];
  const bestImpact = sortedByImpact.find((researcher) => researcher.id !== bestQuery?.id) || sortedByImpact[0];
  const focused =
    list.find((researcher) => researcher.id !== bestQuery?.id && researcher.id !== bestImpact?.id && (researcher.queryRelevanceNorm || 0) >= 60) ||
    list.find((researcher) => researcher.id !== bestQuery?.id && researcher.id !== bestImpact?.id) ||
    list[2];
  const shortlist = uniqueShortlist([
    { researcher: bestQuery, label: "Best query fit", reason: `Q ${Math.round(bestQuery?.queryRelevanceNorm || 0)} with ${formatNumber(bestQuery?.totalWorks || 0)} matched works.` },
    { researcher: bestImpact, label: "Recent impact standout", reason: `${formatNumber(bestImpact?.recentCitations || 0)} R citations in the selected window.` },
    { researcher: focused, label: "Specialized candidate", reason: `${focused?.primaryTopic || "Topic"}; active since ${focused?.careerStartYear || "n/a"}.` },
  ]);
  const modeCopy = searchMode === "institution" ? "This is a strong institution-filter search, so Q mostly reflects whether the researcher matched the searched institution." : searchMode === "author" ? "This is a strong author-name search, so exact and near-exact name matches are prioritized." : "This is a query search, so Q reflects topical fit and R reflects recent citation-window impact.";
  return (
    <section className="border-b border-white/8 bg-[#070a10] px-4 py-3">
      <div className="rounded-lg border border-cyan-400/15 bg-cyan-400/[0.045] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-cyan-100"><Sparkles className="h-3.5 w-3.5 text-cyan-300" />AI Analysis</h2>
          <span className="text-[10px] text-slate-500">Auto-generated from visible Q/R signals</span>
        </div>
        <p className="text-xs leading-5 text-slate-400">
          For "{query}", {top.name} currently ranks highest overall. {modeCopy} Use the shortlist below as a starting point for closer review, not as a final judgment.
        </p>
        <div className="mt-3 grid gap-2 lg:grid-cols-3">
          {shortlist.map((item) => (
            <div key={item.researcher.id} className="rounded-md border border-white/8 bg-black/10 px-3 py-2">
              <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-cyan-200">{item.label}</div>
              <div className="mt-1 truncate text-sm font-semibold text-slate-100">{item.researcher.name}</div>
              <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{item.reason}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const chartModeOptions: Array<{ value: ChartMode; label: string }> = [
  { value: "q-r", label: "Q / R trade-off" },
];

function chartAxes(mode: ChartMode) {
  if (mode === "q-h") return { x: "q" as const, y: "h" as const, xLabel: "Q Relevance", yLabel: "H-Index" };
  if (mode === "r-h") return { x: "r" as const, y: "h" as const, xLabel: "R Impact", yLabel: "H-Index" };
  return { x: "q" as const, y: "r" as const, xLabel: "Q Relevance", yLabel: "R Impact" };
}

function metricValue(researcher: ResearcherRecord, metric: "h" | "q" | "r") {
  if (metric === "h") return researcher.hIndex;
  if (metric === "q") return researcher.queryRelevanceNorm || 0;
  return researcher.recentCitationImpactNorm || 0;
}

function paretoIdsForAxes(list: ResearcherRecord[], xMetric: "h" | "q" | "r", yMetric: "h" | "q" | "r") {
  const ids = new Set<string>();
  for (const candidate of list) {
    const candidateX = metricValue(candidate, xMetric);
    const candidateY = metricValue(candidate, yMetric);
    const dominated = list.some((other) => other.id !== candidate.id && metricValue(other, xMetric) >= candidateX && metricValue(other, yMetric) >= candidateY && (metricValue(other, xMetric) > candidateX || metricValue(other, yMetric) > candidateY));
    if (!dominated) ids.add(candidate.id);
  }
  return ids;
}

function metricAxisDomain(values: number[], metric: "h" | "q" | "r") {
  const fallbackMax = metric === "h" ? 200 : 100;
  if (values.length === 0) return { min: 0, max: fallbackMax };
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  if (maxValue <= minValue) return { min: Math.max(0, minValue - 1), max: minValue + 1 };
  return { min: minValue, max: maxValue };
}

function chartScale(value: number, domain: { min: number; max: number }, metric: "h" | "q" | "r") {
  if (domain.max <= domain.min) return 0;
  return (value - domain.min) / (domain.max - domain.min);
}

function axisTicks(domain: { min: number; max: number }, metric: "h" | "q" | "r") {
  return [domain.min, domain.min + (domain.max - domain.min) * 0.5, domain.max];
}

function formatAxisValue(value: number, metric: "h" | "q" | "r") {
  return String(Math.round(value));
}

function ParetoChart({ list, selected, rankMap, mode, onModeChange, onSelect }: { list: ResearcherRecord[]; selected?: ResearcherRecord; rankMap: Map<string, number>; mode: ChartMode; onModeChange: (mode: ChartMode) => void; onSelect: (researcher: ResearcherRecord) => void }) {
  const sample = list;
  const topTen = new Set(list.slice(0, 10).map((researcher) => researcher.id));
  const axes = chartAxes(mode);
  const frontier = paretoIdsForAxes(sample, axes.x, axes.y);
  const width = 336;
  const height = 210;
  const padLeft = 48;
  const padRight = 18;
  const padTop = 24;
  const padBottom = 42;
  const xDomain = metricAxisDomain(sample.map((researcher) => metricValue(researcher, axes.x)), axes.x);
  const yDomain = metricAxisDomain(sample.map((researcher) => metricValue(researcher, axes.y)), axes.y);
  const point = (researcher: ResearcherRecord) => {
    const x = chartScale(metricValue(researcher, axes.x), xDomain, axes.x);
    const y = chartScale(metricValue(researcher, axes.y), yDomain, axes.y);
    return { x: padLeft + x * (width - padLeft - padRight), y: height - padBottom - y * (height - padTop - padBottom) };
  };
  const xTicks = axisTicks(xDomain, axes.x);
  const yTicks = axisTicks(yDomain, axes.y);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2">
        {chartModeOptions.map((option) => (
          <button key={option.value} onClick={() => onModeChange(option.value)} className={cn("rounded-md border px-2 py-1.5 text-[10px] font-semibold", mode === option.value ? "border-blue-500/60 bg-blue-500/15 text-blue-100" : "border-white/8 text-slate-500 hover:text-slate-200")}>{option.label}</button>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[230px] w-full rounded-md bg-black/20">
        <rect x={padLeft} y={padTop} width={width - padLeft - padRight} height={height - padTop - padBottom} fill="rgba(15,23,42,.42)" />
        <line x1={padLeft} y1={height - padBottom} x2={width - padRight} y2={height - padBottom} stroke="rgba(148,163,184,.38)" />
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={height - padBottom} stroke="rgba(148,163,184,.38)" />
        {xTicks.map((tick) => {
          const x = padLeft + chartScale(tick, xDomain, axes.x) * (width - padLeft - padRight);
          return <g key={tick}><line x1={x} y1={height - padBottom} x2={x} y2={height - padBottom + 4} stroke="rgba(148,163,184,.58)" /><text x={x} y={height - 25} textAnchor="middle" fill="rgba(148,163,184,.8)" fontSize="8">{formatAxisValue(tick, axes.x)}</text></g>;
        })}
        {yTicks.map((tick) => {
          const y = height - padBottom - chartScale(tick, yDomain, axes.y) * (height - padTop - padBottom);
          return <g key={tick}><line x1={padLeft - 4} y1={y} x2={padLeft} y2={y} stroke="rgba(148,163,184,.58)" /><text x={padLeft - 8} y={y + 3} textAnchor="end" fill="rgba(148,163,184,.8)" fontSize="8">{formatAxisValue(tick, axes.y)}</text></g>;
        })}
        <text x={(padLeft + width - padRight) / 2} y={height - 7} textAnchor="middle" fill="rgba(226,232,240,.88)" fontSize="9" fontWeight="700">{axes.xLabel}</text>
        <text x={padLeft} y={13} fill="rgba(226,232,240,.88)" fontSize="9" fontWeight="700">{axes.yLabel}</text>
        {sample.map((researcher, index) => {
          const p = point(researcher);
          const isFrontier = frontier.has(researcher.id);
          const isTop = topTen.has(researcher.id);
          const isSelected = selected?.id === researcher.id;
          const radius = 2.2 + Math.min(7, (researcher.finalScore || 0) / 14);
          const color = isSelected ? "#67e8f9" : isTop ? "#facc15" : isFrontier ? "#34d399" : "#60a5fa";
          return (
            <g key={researcher.id} onClick={() => onSelect(researcher)}>
              <circle cx={p.x} cy={p.y} r={isSelected ? radius + 1.5 : radius} fill={color} opacity={isSelected || isTop || isFrontier ? 0.88 : 0.34} stroke={isFrontier || isSelected ? "#22d3ee" : "transparent"} strokeWidth={isSelected ? 2 : 1}>
                <title>{rankMap.get(researcher.id) ?? index + 1}. {researcher.name}</title>
              </circle>
              {(rankMap.get(researcher.id) ?? index + 1) <= 10 || isSelected ? <text x={p.x} y={p.y + 2.2} textAnchor="middle" fontSize="7" fontWeight="700" fill="#020617">{rankMap.get(researcher.id) ?? index + 1}</text> : null}
            </g>
          );
        })}
      </svg>
      <div className="flex items-center gap-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-500" />Top 10</span>
        <span title="Strong trade-off candidates for the selected chart axes." className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-500" />Trade-off picks</span>
        <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-blue-600" />Pool</span>
      </div>
      <p className="text-[10px] leading-relaxed text-slate-500">Bubble size = current ranking score. Click any point to select that researcher.</p>
    </div>
  );
}
function LandingPage({ query, setQuery, onSearch, history, searchMode, setSearchMode, settings, user, onLogout, onOpenSettings, onOpenAuth }: { query: string; setQuery: (query: string) => void; onSearch: (query?: string) => void; history: string[]; searchMode: SearchModeChoice; setSearchMode: (mode: SearchModeChoice) => void; settings: AppSettings; user?: CurrentUser; onLogout: () => void; onOpenSettings: () => void; onOpenAuth: (mode: AuthMode) => void }) {
  const topics = TOPIC_FALLBACK;
  return (
    <main className="flex h-screen flex-col items-center justify-center bg-[#05070b] px-6 text-slate-100">
      <div className="absolute left-6 top-5"><button onClick={onOpenSettings} className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/[0.06] hover:text-slate-100"><Settings className="mr-1 inline h-3.5 w-3.5" />Settings</button></div>
      <div className="absolute right-6 top-5"><TopActions user={user} onLogout={onLogout} onOpenSettings={onOpenSettings} onOpenAuth={onOpenAuth} /></div>
      <div className="mb-8 flex flex-col items-center">
        <div className="mb-3"><BrandMark /></div>
        <h1 className="text-4xl font-bold tracking-tight" style={{ fontFamily: "'Sora', sans-serif" }}>{BRAND_NAME}</h1>
        <p className="mt-2 text-sm text-slate-500">AI-powered academic researcher search</p>
      </div>
      <div className="w-full max-w-[640px]">
        <SearchInputWithHistory query={query} setQuery={setQuery} onSearch={onSearch} history={history} searchMode={searchMode} setSearchMode={setSearchMode} />
        <div className="mt-5 flex justify-center">
          <button className="rounded-md bg-blue-600 px-6 py-2 text-sm font-semibold text-white hover:bg-blue-500" onClick={() => onSearch()}>Search Researchers</button>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-500">
        <span className="mr-2 w-full text-center text-slate-600">Trending topics</span>
        {topics.map((topic) => <button key={topic} className="rounded-full border border-white/8 px-3 py-1 hover:border-blue-500/50 hover:text-slate-200" onClick={() => { setSearchMode("topic"); setQuery(topic.toLowerCase()); onSearch(topic.toLowerCase()); }}>{topic}</button>)}
      </div>
      <ChatFloatingButton query={query} settings={settings} />
      <footer className="absolute bottom-6 text-center text-[11px] text-slate-600">{BRAND_NAME} · AI-powered academic search · ranking backend data<br /><TeamCredit /></footer>
    </main>
  );
}

function FilterRail({ filters, setFilters, countries, selected, savedResearchers, chartList, rankMap, onSelect, onToggleSave }: { filters: Filters; setFilters: (filters: Filters) => void; countries: string[]; selected?: ResearcherRecord; savedResearchers: ResearcherRecord[]; chartList: ResearcherRecord[]; rankMap: Map<string, number>; onSelect: (researcher: ResearcherRecord) => void; onToggleSave: (researcher: ResearcherRecord) => void }) {
  return (
    <aside className="w-[var(--filter-rail-width)] shrink-0 overflow-y-auto border-r border-white/8 bg-[#070a10] px-5 py-5">
      <Section id="saved" title={`Saved Researchers (${savedResearchers.length})`} filters={filters} setFilters={setFilters}>
        <div className="mb-3 space-y-1">
          {savedResearchers.length === 0 ? (
            <p className="rounded-md border border-white/8 bg-white/[0.025] px-3 py-2 text-xs text-slate-500">No saved researchers yet.</p>
          ) : (
            savedResearchers.map((researcher) => (
              <div
                key={researcher.id}
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white/[0.04]", selected?.id === researcher.id ? "bg-blue-500/15 text-blue-100" : "text-slate-400")}
              >
                <button onClick={() => onSelect(researcher)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-[9px] font-bold text-blue-200">{researcher.initials || initials(researcher.name)}</span>
                  <span className="min-w-0 flex-1 truncate">{researcher.name}</span>
                </button>
                <button title="Remove saved researcher" onClick={() => onToggleSave(researcher)} className="shrink-0 rounded p-1 text-slate-500 hover:bg-white/8 hover:text-slate-100"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))
          )}
        </div>
      </Section>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-xs font-bold uppercase tracking-[0.16em] text-slate-300">Filters</h2><SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" /></div>
      <Section id="ranking" title="Ranking Weights" filters={filters} setFilters={setFilters}>
        <div className="space-y-3">
          <WeightSlider label="Query relevance" color="#22c55e" value={filters.weights.query} onChange={(value) => setFilters({ ...filters, weights: { ...filters.weights, query: value } })} />
          <WeightSlider label="Research impact" color="#fb923c" value={filters.weights.research} onChange={(value) => setFilters({ ...filters, weights: { ...filters.weights, research: value } })} />
          <p className="text-[10px] leading-4 text-slate-500">Final Score = wQ * Q_norm + wR * R_norm. H-index is profile context, not part of the default score.</p>
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            {[["Default", { query: 70, research: 30 }], ["Q only", { query: 100, research: 0 }], ["R only", { query: 0, research: 100 }]].map(([label, weights]) => <button key={label as string} className="rounded border border-white/8 bg-white/[0.03] py-1 text-[10px] text-slate-400 hover:text-slate-100" onClick={() => setFilters({ ...filters, weights: weights as Record<WeightKey, number> })}>{label as string}</button>)}
          </div>
        </div>
      </Section>
      <Section id="frontier" title="Q / R Frontier" filters={filters} setFilters={setFilters}>
        <ParetoChart list={chartList} selected={selected} rankMap={rankMap} mode={filters.chartMode} onModeChange={(chartMode) => setFilters({ ...filters, chartMode })} onSelect={onSelect} />
      </Section>
      <Section id="year" title="Citation Year Range" filters={filters} setFilters={setFilters}>
        <YearRangeSlider filters={filters} setFilters={setFilters} />
      </Section>
      <Section id="country" title="Country" filters={filters} setFilters={setFilters}><select value={filters.country} onChange={(event) => setFilters({ ...filters, country: event.target.value })} className="w-full rounded-md border border-white/10 bg-[#0d1119] px-2 py-2 text-xs text-slate-200 outline-none"><option>All</option>{countries.map((country) => <option key={country}>{country}</option>)}</select></Section>
      <Section id="type" title="Researcher Type" filters={filters} setFilters={setFilters}>
        <div className="grid grid-cols-1 gap-1.5">{[["pool", "Pool"], ["top10", "Top 10"], ["frontier", "Frontier"]].map(([value, label]) => <button key={value} onClick={() => setFilters({ ...filters, pool: value as ResearcherPool })} className={cn("rounded-md border px-3 py-2 text-left text-xs", filters.pool === value ? "border-blue-500/50 bg-blue-500/15 text-blue-100" : "border-white/8 text-slate-400")}>{label}</button>)}</div>
      </Section>
      <TeamCredit className="pt-4" />
    </aside>
  );
}

function ResearcherTable({
  list,
  selected,
  savedIds,
  startRank,
  emptyState,
  sort,
  onSort,
  onSelect,
  onOpenDetail,
  onToggleSave,
  onAskAi,
}: {
  list: ResearcherRecord[];
  selected?: ResearcherRecord;
  savedIds: Set<string>;
  startRank: number;
  emptyState: string;
  sort: { key: TableSortKey; direction: SortDirection };
  onSort: (key: TableSortKey) => void;
  onSelect: (researcher: ResearcherRecord) => void;
  onOpenDetail: (researcher: ResearcherRecord) => void;
  onToggleSave: (researcher: ResearcherRecord) => void;
  onAskAi: (researcher: ResearcherRecord) => void;
}) {
  const metricHeader = (key: TableSortKey, label: string, title: string) => (
    <button title={title} onClick={() => onSort(key)} className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-white/8 hover:text-slate-100">
      {label}
      <ChevronDown className={cn("h-3 w-3 transition-transform", sort.key === key ? "opacity-100" : "opacity-30", sort.key === key && sort.direction === "asc" && "rotate-180")} />
    </button>
  );
  return (
    <div className="min-w-0 flex-1 overflow-auto bg-[#05070b]">
      <table className="w-full min-w-[var(--researcher-table-min-width)] border-separate border-spacing-0 text-left text-sm">
        <thead className="sticky top-0 z-10 bg-[#070a10] text-[11px] uppercase tracking-[0.14em] text-slate-400">
          <tr>
            <th className="w-10 border-b border-white/8 px-3 py-3">{metricHeader("rank", "#", "Default ranked order")}</th>
            <th className="w-[30%] border-b border-white/8 px-3 py-3">Researcher</th>
            <th className="w-[27%] border-b border-white/8 px-3 py-3">Institution</th>
            <th className="border-b border-white/8 px-3 py-3">{metricHeader("query", "Q", "Normalized query relevance within the visible result set.")}</th>
            <th className="border-b border-white/8 px-3 py-3">{metricHeader("recentCitations", "R", "Citations received by matched papers during the selected citation year range.")}</th>
            <th className="border-b border-white/8 px-3 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>{list.length === 0 ? (
          <tr><td colSpan={6} className="px-6 py-16 text-center text-sm text-slate-500">{emptyState}</td></tr>
        ) : list.map((researcher, index) => {
          const rank = startRank + index;
          const affiliation = affiliationDisplay(researcher);
          return (
            <tr key={researcher.id} onClick={() => onSelect(researcher)} onDoubleClick={() => onOpenDetail(researcher)} className={cn("cursor-pointer border-b border-white/5 text-slate-300 hover:bg-white/[0.035]", selected?.id === researcher.id && "bg-blue-500/[0.08]")}>
              <td className="px-3 py-3.5 font-mono text-amber-300">{rank}</td>
              <td className="px-3 py-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-[11px] font-bold text-blue-100">{researcher.initials || initials(researcher.name)}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-100">
                      <span className="truncate">{researcher.name}</span>
                      {rank <= 10 && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-200">TOP</span>}
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
                      <span className="truncate">{researcher.primaryTopic}</span>
                      <span title={researcher.matchReason || researcher.whyMatched} className="shrink-0 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-200">{matchSourceLabel(researcher.matchSource)}</span>
                    </div>
                  </div>
                </div>
              </td>
              <td className="max-w-[260px] px-3 py-3.5 font-semibold text-slate-200">
                <div className="truncate" title={affiliation.primary}>{affiliation.primary}</div>
                {affiliation.note && <div className="truncate text-[11px] font-normal text-cyan-300" title={affiliation.note}>{affiliation.note}</div>}
                <div className="text-xs font-normal text-slate-500">{affiliation.country}</div>
              </td>
              <td className="px-3 py-3.5 font-mono text-base font-extrabold text-emerald-300">{Math.round(researcher.queryRelevanceNorm || 0)}</td>
              <td className="px-3 py-3.5 font-mono text-base font-extrabold text-orange-300">{formatNumber(researcher.recentCitations || 0)}</td>
              <td className="px-3 py-3.5"><div className="flex items-center gap-1.5 text-slate-400"><button title={savedIds.has(researcher.id) ? "Saved" : "Save researcher"} onClick={(event) => { event.stopPropagation(); onToggleSave(researcher); }} className={cn("rounded p-1.5 hover:bg-white/8 hover:text-slate-100", savedIds.has(researcher.id) && "text-cyan-300")}>{savedIds.has(researcher.id) ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}</button><a title="Search on Google" href={googleResearcherUrl(researcher)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="rounded p-1.5 hover:bg-white/8 hover:text-slate-100"><ExternalLink className="h-4 w-4" /></a><button title="Ask AI about this researcher" onClick={(event) => { event.stopPropagation(); onAskAi(researcher); }} className="rounded p-1.5 hover:bg-white/8 hover:text-cyan-200"><Bot className="h-4 w-4" /></button></div></td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function PaginationBar({ page, total, onPageChange }: { page: number; total: number; onPageChange: (page: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const end = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-t border-white/8 bg-[#070a10] px-5 text-xs text-slate-400">
      <span>Showing {start}-{end} of {total}</span>
      <div className="flex items-center gap-2">
        <button disabled={page === 0} onClick={() => onPageChange(page - 1)} className="rounded-md border border-white/10 px-3 py-1.5 text-slate-300 disabled:cursor-not-allowed disabled:opacity-35 hover:bg-white/[0.04]">Previous</button>
        <span className="font-mono text-slate-300">Page {page + 1} / {totalPages}</span>
        <button disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)} className="rounded-md border border-white/10 px-3 py-1.5 text-slate-300 disabled:cursor-not-allowed disabled:opacity-35 hover:bg-white/[0.04]">Next</button>
      </div>
    </div>
  );
}

function citationCoverageRatio(researcher: ResearcherRecord) {
  const paperCitationSample = researcher.papers.reduce((sum, paper) => sum + paper.citations, 0);
  if (researcher.totalCitations <= 0) return paperCitationSample > 0 ? 1 : 0;
  return Math.min(1, paperCitationSample / researcher.totalCitations);
}

function rawResearcherSnapshot(researcher: ResearcherRecord) {
  return {
    id: researcher.id,
    institutionId: researcher.institutionId,
    name: researcher.name,
    initials: researcher.initials,
    institution: researcher.institution,
    affiliation: researcher.affiliation || null,
    matchedInstitution: researcher.matchedInstitution || null,
    matchedInstitutionId: researcher.matchedInstitutionId || null,
    matchedInstitutionCountry: researcher.matchedInstitutionCountry || null,
    currentInstitution: researcher.currentInstitution || null,
    currentInstitutionId: researcher.currentInstitutionId || null,
    currentInstitutionCountry: researcher.currentInstitutionCountry || null,
    country: researcher.country,
    region: researcher.region,
    field: researcher.field,
    subfield: researcher.subfield,
    domain: researcher.domain,
    primaryTopic: researcher.primaryTopic,
    topics: researcher.topics,
    keywords: researcher.keywords || [],
    researchThemes: researcher.researchThemes || [],
    totalWorks: researcher.totalWorks,
    totalCitations: researcher.totalCitations,
    recentCitations: researcher.recentCitations || 0,
    citationStartYear: researcher.citationStartYear || null,
    citationEndYear: researcher.citationEndYear || null,
    queryRelevanceScore: researcher.queryRelevanceScore || researcher.relevanceScore || 0,
    queryRelevanceNorm: researcher.queryRelevanceNorm || 0,
    recentCitationImpactNorm: researcher.recentCitationImpactNorm || 0,
    finalScore: researcher.finalScore || 0,
    hIndex: researcher.hIndex,
    i10Index: researcher.i10Index,
    careerStartYear: researcher.careerStartYear,
    yearsActive: researcher.yearsActive,
    role: researcher.role || null,
    authorUrl: researcher.authorUrl || null,
    scholarUrl: researcher.scholarUrl || null,
    googleUrl: researcher.googleUrl || null,
    matchSource: researcher.matchSource || null,
    matchReason: researcher.matchReason || researcher.whyMatched || null,
    searchMode: researcher.searchMode || null,
    coAuthorCount: researcher.coAuthorCount ?? researcher.collaborators.length,
    collaborators: researcher.collaborators,
    papers: researcher.papers.map((paper) => ({
      id: paper.id,
      title: paper.title,
      year: paper.year,
      venue: paper.venue,
      venueType: paper.venueType,
      citations: paper.citations,
      recentCitations: paper.recentCitations || 0,
      citationYearCounts: paper.citationYearCounts || [],
      concept: paper.concept,
      url: paperUrl(paper),
    })),
  };
}

function RankingBreakdown({ researcher, weights, compact = false }: { researcher: ResearcherRecord; weights: Record<WeightKey, number>; compact?: boolean }) {
  const qNorm = researcher.queryRelevanceNorm || 0;
  const rNorm = researcher.recentCitationImpactNorm || 0;
  const shares = rankingWeightShares(weights);
  const finalScore = finalRankingScore(qNorm, rNorm, weights);
  const items = [
    {
      key: "q",
      label: "Q_norm",
      value: qNorm,
      weight: shares.query,
      contribution: qNorm * shares.query,
      description: "Query relevance: how strongly this researcher matches the current search.",
      color: "bg-emerald-400/80",
    },
    {
      key: "r",
      label: "R_norm",
      value: rNorm,
      weight: shares.research,
      contribution: rNorm * shares.research,
      description: "Citation impact: log-normalized R_raw from the selected citation year range.",
      color: "bg-orange-400/85",
    },
  ];
  return (
    <div className={cn("rounded-lg border border-white/8 bg-white/[0.025] p-4", compact && "p-3.5")}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-200">Ranking Score</h3>
        <span className="font-mono text-sm font-extrabold text-blue-300">{Math.round(finalScore)}</span>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-slate-500">
        Final Score = wQ * Q_norm + wR * R_norm. R_raw = {formatNumber(researcher.recentCitations || 0)} citations received during {researcher.citationStartYear || "n/a"}-{researcher.citationEndYear || "n/a"}. H-index is shown separately and does not affect this score.
      </p>
      <div className="mt-3 space-y-2.5">
        {items.map((item) => (
          <div key={item.key}>
            <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-slate-300" title={item.description}>{item.label}</span>
              <span className="shrink-0 font-mono text-slate-500">{Math.round(item.value)} x {Math.round(item.weight * 100)}% = {item.contribution.toFixed(1)}</span>
            </div>
            {!compact && <p className="mb-1.5 text-[11px] leading-5 text-slate-500">{item.description}</p>}
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className={cn("h-full rounded-full", item.color)} style={{ width: `${Math.min(100, Math.max(0, item.value))}%` }} />
            </div>
          </div>
        ))}
      </div>
      {!compact && (
        <div className="mt-4 grid gap-2 text-[11px] sm:grid-cols-3">
          <div className="rounded-md border border-white/8 bg-black/10 p-2">
            <div className="text-slate-500">Q_norm</div>
            <div className="mt-1 font-mono font-bold text-emerald-300">{Math.round(qNorm)}</div>
          </div>
          <div className="rounded-md border border-white/8 bg-black/10 p-2">
            <div className="text-slate-500">R_raw</div>
            <div className="mt-1 font-mono font-bold text-orange-300">{formatNumber(researcher.recentCitations || 0)}</div>
          </div>
          <div className="rounded-md border border-white/8 bg-black/10 p-2">
            <div className="text-slate-500">R_norm</div>
            <div className="mt-1 font-mono font-bold text-orange-300">{Math.round(rNorm)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function SideSummary({ researcher, isSaved, onToggleSave, onOpenDetail, onAskAi }: { researcher?: ResearcherRecord; isSaved: boolean; onToggleSave: () => void; onOpenDetail: () => void; onAskAi: () => void }) {
  return (
    <aside className="w-[var(--side-summary-width)] shrink-0 overflow-y-auto border-l border-white/8 bg-[#070a10] p-4">
      {researcher ? (
        <>
          <div className="rounded-lg border border-white/8 bg-white/[0.025] p-3.5">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-blue-500/40 bg-blue-500/15 text-base font-bold text-blue-100">{researcher.initials || initials(researcher.name)}</div>
              <div className="min-w-0">
                <h2 className="truncate font-bold text-slate-100">{researcher.name}</h2>
                <AffiliationSummary researcher={researcher} className="text-xs text-slate-500" />
                <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-blue-300">{affiliationDisplay(researcher).country} - since {researcher.careerStartYear || "n/a"}</p>
                <span title={researcher.matchReason || researcher.whyMatched} className="mt-2 inline-flex max-w-full rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold text-cyan-200">{matchSourceLabel(researcher.matchSource)}</span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">{[["Q", Math.round(researcher.queryRelevanceNorm || 0), "text-emerald-300"], ["R", formatNumber(researcher.recentCitations || 0), "text-orange-300"]].map(([label, value, color]) => <div key={label} title={metricDescription(label as string)} className="rounded-md border border-white/8 bg-black/10 p-2"><div className={cn("font-mono text-lg font-extrabold", color as string)}>{value}</div><div className="text-[10px] text-slate-500">{label}</div></div>)}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={onToggleSave} className={cn("rounded-md border border-white/8 py-2 text-xs hover:text-slate-100", isSaved ? "text-blue-300" : "text-slate-400")}>{isSaved ? <BookmarkCheck className="mr-1 inline h-3.5 w-3.5" /> : <Bookmark className="mr-1 inline h-3.5 w-3.5" />}{isSaved ? "Saved" : "Save"}</button>
              <button onClick={onOpenDetail} className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500">Details</button>
              <a href={googleResearcherUrl(researcher)} target="_blank" rel="noreferrer" className="rounded-md border border-white/8 py-2 text-center text-xs text-slate-400 hover:text-slate-100"><ExternalLink className="mr-1 inline h-3.5 w-3.5" />Google</a>
              <button onClick={onAskAi} className="rounded-md border border-cyan-400/25 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10"><Bot className="mr-1 inline h-3.5 w-3.5" />Ask AI</button>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-white/8 bg-white/[0.025] p-3.5"><h3 className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-100">Research Topics</h3><div className="flex flex-wrap gap-2">{(researcher.topics.length ? researcher.topics : [researcher.primaryTopic]).slice(0, 4).map((topic, index) => <span key={`${topic}-${index}`} className="rounded-full bg-blue-500/15 px-2.5 py-1 text-[11px] font-semibold text-blue-100">{topic}</span>)}</div></div>
        </>
      ) : (
        <div className="rounded-lg border border-white/8 bg-white/[0.025] p-4 text-sm text-slate-500">Select a researcher to inspect profile metrics, reliability hints, and returned backend fields.</div>
      )}
    </aside>
  );
}

function AiSummaryPage({ researcher, isSaved, user, query, list, settings, autoRequest, onBack, onToggleSave, onOpenDetail, onLogout, onOpenSettings, onOpenAuth }: { researcher: ResearcherRecord; isSaved: boolean; user?: CurrentUser; query: string; list: ResearcherRecord[]; settings: AppSettings; autoRequest?: AiAutoRequest; onBack: () => void; onToggleSave: () => void; onOpenDetail: () => void; onLogout: () => void; onOpenSettings: () => void; onOpenAuth: (mode: AuthMode) => void }) {
  const affiliation = affiliationDisplay(researcher);
  return (
    <main className="h-screen overflow-y-auto bg-[#05070b] text-slate-100">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#070a10]/95 px-8 py-4 backdrop-blur">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-100"><ArrowLeft className="h-4 w-4" />Back to results</button>
        <div className="flex items-center gap-2">
          <a href={googleResearcherUrl(researcher)} target="_blank" rel="noreferrer" className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-400 hover:text-slate-100"><ExternalLink className="mr-1 inline h-3.5 w-3.5" />Google Search</a>
          <button onClick={onOpenDetail} className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-400 hover:text-slate-100">Profile details</button>
          <button onClick={onToggleSave} className={cn("rounded-md border border-white/10 px-3 py-2 text-xs hover:text-slate-100", isSaved ? "text-blue-300" : "text-slate-400")}>{isSaved ? <BookmarkCheck className="mr-1 inline h-3.5 w-3.5" /> : <Bookmark className="mr-1 inline h-3.5 w-3.5" />}{isSaved ? "Saved" : "Save"}</button>
          <TopActions user={user} onLogout={onLogout} onOpenSettings={onOpenSettings} onOpenAuth={onOpenAuth} />
        </div>
      </header>
      <div className="mx-auto grid max-w-[1180px] gap-5 px-8 py-8 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="rounded-xl border border-white/8 bg-white/[0.025] p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-blue-500/40 bg-blue-500/15 text-lg font-bold text-blue-100">{researcher.initials || initials(researcher.name)}</div>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold">{researcher.name}</h1>
                <AffiliationSummary researcher={researcher} className="text-sm text-slate-400" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-white/8 bg-black/10 p-3"><div className="font-mono text-xl font-bold text-emerald-300">{Math.round(researcher.queryRelevanceNorm || 0)}</div><div className="text-[10px] text-slate-500">Q relevance</div></div>
              <div className="rounded-md border border-white/8 bg-black/10 p-3"><div className="font-mono text-xl font-bold text-orange-300">{formatNumber(researcher.recentCitations || 0)}</div><div className="text-[10px] text-slate-500">R impact</div></div>
            </div>
            <div className="mt-4 space-y-2 text-xs leading-5 text-slate-500">
              <p><span className="text-slate-300">Query:</span> {query || "n/a"}</p>
              <p><span className="text-slate-300">Institution:</span> {affiliation.primary}</p>
              <p><span className="text-slate-300">Topic:</span> {researcher.primaryTopic}</p>
              <p><span className="text-slate-300">Context H-index:</span> {researcher.hIndex}</p>
            </div>
          </section>
          <section className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-4 text-xs leading-6 text-slate-400">
            This page generates a profile brief in the context of the current query. It uses only visible ranking/profile data and the editable prompt; it should not mention any private sponsor or business intent.
          </section>
        </aside>
        <section className="min-w-0">
          <div className="mb-4 flex items-center gap-3">
            <BrandMark compact />
            <div>
              <h2 className="text-2xl font-bold">AI researcher summary</h2>
              <p className="text-sm text-slate-500">Generated review page for {researcher.name}</p>
            </div>
          </div>
          <ResultsAiPanel list={list} query={query} settings={settings} researcher={researcher} autoRequest={autoRequest} />
        </section>
      </div>
    </main>
  );
}

function DetailPage({ researcher, isSaved, user, weights, onToggleSave, onAskAi, onBack, onLogout, onOpenSettings, onOpenAuth }: { researcher: ResearcherRecord; isSaved: boolean; user?: CurrentUser; weights: Record<WeightKey, number>; onToggleSave: () => void; onAskAi: () => void; onBack: () => void; onLogout: () => void; onOpenSettings: () => void; onOpenAuth: (mode: AuthMode) => void }) {
  const paperCitationSample = researcher.papers.reduce((sum, paper) => sum + paper.citations, 0);
  const citationCoverage = citationCoverageRatio(researcher);
  const rawSnapshot = rawResearcherSnapshot(researcher);
  const weightShares = rankingWeightShares(weights);
  const headlineMetrics = [
    { label: "Q relevance", value: Math.round(researcher.queryRelevanceNorm || 0), caption: "Normalized query fit", color: "text-emerald-400", description: metricDescription("Query relevance") },
    { label: "R impact", value: formatNumber(researcher.recentCitations || 0), caption: `${researcher.citationStartYear || ""}-${researcher.citationEndYear || ""}`, color: "text-orange-400", description: metricDescription("Research impact") },
    { label: "H profile", value: researcher.hIndex, caption: "Profile context", color: "text-blue-400", description: metricDescription("H profile") },
    { label: "Lifetime cites", value: formatNumber(researcher.totalCitations), caption: "Profile total", color: "text-cyan-400", description: metricDescription("Raw citations") },
  ];
  return (
    <main className="h-screen overflow-y-auto bg-[#05070b] text-slate-100">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#070a10]/95 px-8 py-4 backdrop-blur"><button onClick={onBack} className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-100"><ArrowLeft className="h-4 w-4" />Back to results</button><div className="flex items-center gap-2"><a href={googleResearcherUrl(researcher)} target="_blank" rel="noreferrer" className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-400 hover:text-slate-100"><ExternalLink className="mr-1 inline h-3.5 w-3.5" />Google Search</a><button onClick={onAskAi} className="rounded-md border border-cyan-400/25 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10"><Bot className="mr-1 inline h-3.5 w-3.5" />Ask AI</button><button onClick={onToggleSave} className={cn("rounded-md border border-white/10 px-3 py-2 text-xs hover:text-slate-100", isSaved ? "text-blue-300" : "text-slate-400")}>{isSaved ? <BookmarkCheck className="mr-1 inline h-3.5 w-3.5" /> : <Bookmark className="mr-1 inline h-3.5 w-3.5" />}{isSaved ? "Saved" : "Save Researcher"}</button><TopActions user={user} onLogout={onLogout} onOpenSettings={onOpenSettings} onOpenAuth={onOpenAuth} /></div></header>
      <div className="mx-auto max-w-[1040px] px-8 py-8">
        <section className="rounded-xl border border-white/8 bg-white/[0.025] p-6"><div className="flex items-center gap-5"><div className="relative flex h-20 w-20 items-center justify-center rounded-xl border border-blue-500/40 bg-blue-500/15 text-2xl font-bold text-blue-100">{researcher.initials || initials(researcher.name)}<Sparkles className="absolute -bottom-2 -right-2 h-5 w-5 rounded-full bg-blue-600 p-1 text-white" /></div><div><h1 className="text-3xl font-bold">{researcher.name}</h1><AffiliationSummary researcher={researcher} className="mt-1 text-sm text-slate-400" /><div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold text-blue-200"><span className="rounded-full bg-white/8 px-3 py-1">{affiliationDisplay(researcher).country || "n/a"}</span><span className="rounded-full bg-white/8 px-3 py-1">Active since {researcher.careerStartYear || "n/a"}</span><span className="rounded-full bg-blue-500/15 px-3 py-1">{researcher.primaryTopic}</span><span title={researcher.matchReason || researcher.whyMatched} className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-cyan-200">{matchSourceLabel(researcher.matchSource)}</span></div></div></div></section>
        <section className="mt-6 grid grid-cols-4 gap-4">
          {headlineMetrics.map((metric) => (
            <div key={metric.label} title={metric.description} className="rounded-lg border border-white/8 bg-white/[0.025] p-5">
              <div className={cn("font-mono text-2xl font-bold", metric.color)}>{metric.value}</div>
              <div className="mt-1 text-xs font-bold text-slate-200">{metric.label}</div>
              <div className="text-[10px] text-slate-500">{metric.caption}</div>
              <p className="mt-3 text-[11px] leading-5 text-slate-500">{metric.description}</p>
            </div>
          ))}
        </section>
        <section className="mt-6"><RankingBreakdown researcher={researcher} weights={weights} /></section>
        <section className="mt-6 rounded-xl border border-white/8 bg-white/[0.025] p-6"><h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.12em]"><Sparkles className="h-4 w-4 text-blue-400" />Profile Context</h2><p className="text-sm leading-7 text-slate-400">{researcher.name} is indexed as a {researcher.primaryTopic} researcher in {researcher.field || "computer science"}. For the current ranking, Q_norm is {Math.round(researcher.queryRelevanceNorm || 0)} and R_raw is {formatNumber(researcher.recentCitations || 0)} citations received by matched papers during {researcher.citationStartYear}-{researcher.citationEndYear}. Lifetime citations, total works, and H-index are shown as profile context only. The profile is linked to {affiliationDisplay(researcher).primary} and includes {researcher.collaborators.length} highlighted collaborators.</p><div className="mt-5 flex flex-wrap gap-2">{(researcher.topics.length ? researcher.topics : [researcher.primaryTopic]).slice(0, 6).map((topic, index) => <span key={`${topic}-${index}`} className="rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-200">{topic}</span>)}</div></section>
        <section className="mt-6 rounded-xl border border-white/8 bg-white/[0.025] p-6"><h2 className="mb-4 text-sm font-bold uppercase tracking-[0.12em]">Contact & Links</h2><div className="grid gap-3 text-sm text-slate-400 sm:grid-cols-2"><div className="rounded-lg border border-white/8 bg-black/10 p-4"><div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{researcher.searchMode === "institution" ? "Matched institution" : "Institution"}</div><AffiliationSummary researcher={researcher} className="mt-2 text-slate-200" noteClassName="mt-1 text-xs text-cyan-300" /><div className="text-xs text-slate-500">{affiliationDisplay(researcher).country}{researcher.region ? `, ${researcher.region}` : ""}</div></div><div className="rounded-lg border border-white/8 bg-black/10 p-4"><div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Direct Contact</div><div className="mt-2 text-slate-300">The backend profile does not provide email or phone fields.</div></div></div><div className="mt-4 flex flex-wrap gap-2">{researcher.authorUrl && <a href={researcher.authorUrl} target="_blank" rel="noreferrer" className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500">Author Profile</a>}<a href={googleScholarUrl(researcher)} target="_blank" rel="noreferrer" className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500">Google Scholar</a><a href={googleResearcherUrl(researcher)} target="_blank" rel="noreferrer" className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500">Google Search</a></div></section>
        <section className="mt-6 rounded-xl border border-white/8 bg-white/[0.025] p-6">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.12em] text-slate-100">Source Data & Reliability</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-white/8 bg-black/10 p-4"><div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Profile IDs</div><div className="mt-2 font-mono text-sm text-slate-100">{researcher.id}</div><div className="mt-1 text-[11px] text-slate-500">{researcher.institutionId || "No institution id"}</div></div>
            <div className="rounded-lg border border-white/8 bg-black/10 p-4"><div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Indexed papers</div><div className="mt-2 text-2xl font-bold text-slate-100">{researcher.papers.length}</div><div className="mt-1 text-[11px] text-slate-500">{researcher.totalWorks} total works reported</div></div>
            <div className="rounded-lg border border-white/8 bg-black/10 p-4"><div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Citation coverage</div><div className="mt-2 text-2xl font-bold text-slate-100">{Math.round(citationCoverage * 100)}%</div><div className="mt-1 text-[11px] text-slate-500">{formatNumber(paperCitationSample)} citations visible in indexed papers</div></div>
            <div className="rounded-lg border border-white/8 bg-black/10 p-4"><div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Collaborators shown</div><div className="mt-2 text-2xl font-bold text-slate-100">{researcher.collaborators.length}</div><div className="mt-1 text-[11px] text-slate-500">{researcher.coAuthorCount ? `${researcher.coAuthorCount} total co-authors reported` : "Only highlighted collaborators available"}</div></div>
          </div>
          <p className="mt-4 text-xs leading-6 text-slate-500">Use the expanders below to inspect backend-returned profile fields. Ranking uses Q/R; lifetime citations and H-index are profile context only.</p>
          <div className="mt-4 space-y-3">
            <details className="rounded-lg border border-white/8 bg-black/10">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-100">Profile record fields</summary>
              <div className="border-t border-white/8 p-4">
                <div className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                  {[["Name", researcher.name], ["Institution", researcher.institution], ["Matched institution", researcher.matchedInstitution || "n/a"], ["Current institution", researcher.currentInstitution || "n/a"], ["Country", affiliationDisplay(researcher).country || "n/a"], ["Region", researcher.region || "n/a"], ["Field", researcher.field || "n/a"], ["Subfield", researcher.subfield || "n/a"], ["Domain", researcher.domain || "n/a"], ["Primary topic", researcher.primaryTopic], ["Match source", matchSourceLabel(researcher.matchSource)], ["Match reason", researcher.matchReason || researcher.whyMatched || "n/a"], ["Citation year range", `${researcher.citationStartYear || "n/a"}-${researcher.citationEndYear || "n/a"}`], ["Q_norm", Math.round(researcher.queryRelevanceNorm || 0)], ["R_raw", researcher.recentCitations || 0], ["R_norm", Math.round(researcher.recentCitationImpactNorm || 0)], ["wQ", `${Math.round(weightShares.query * 100)}%`], ["wR", `${Math.round(weightShares.research * 100)}%`], ["Final score", Math.round(researcher.finalScore || 0)], ["Career start", researcher.careerStartYear || "n/a"], ["Years active", researcher.yearsActive || "n/a"], ["Total works", researcher.totalWorks], ["Lifetime citations", researcher.totalCitations], ["H-index", researcher.hIndex], ["I10-index", researcher.i10Index]].map(([label, value]) => <div key={label as string}><div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</div><div className="mt-1 text-slate-200">{String(value)}</div></div>)}
                </div>
              </div>
            </details>
            <details className="rounded-lg border border-white/8 bg-black/10">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-100">Matched works ({researcher.papers.length})</summary>
              <div className="border-t border-white/8 p-4">
                {researcher.papers.length === 0 ? <p className="text-sm text-slate-500">No matched works are present for this researcher.</p> : <div className="space-y-3">{researcher.papers.map((paper) => <div key={paper.id} className="rounded-lg border border-white/8 bg-[#05070b] p-3"><div className="flex items-start justify-between gap-4"><div><div className="text-sm font-semibold text-slate-100">{paper.title}</div><div className="mt-1 text-xs text-slate-500">{paper.year || "n/a"} · {paper.venue || "Unknown venue"} · {paper.concept || "No concept label"}</div><div className="mt-1 font-mono text-[10px] text-slate-600">{paper.id}</div></div><div className="text-right"><div className="font-mono text-sm font-bold text-orange-300">{formatNumber(paper.recentCitations || 0)}</div><div className="text-[10px] text-slate-500">R cites</div><a href={paperUrl(paper)} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs text-blue-300 hover:text-blue-200">Open source<ExternalLink className="ml-1 h-3 w-3" /></a></div></div>{paper.abstract && <p className="mt-3 text-xs leading-6 text-slate-500">{paper.abstract}</p>}</div>)}</div>}
              </div>
            </details>
            <details className="rounded-lg border border-white/8 bg-black/10">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-100">Collaborators ({researcher.collaborators.length})</summary>
              <div className="border-t border-white/8 p-4">
                {researcher.collaborators.length === 0 ? <p className="text-sm text-slate-500">No collaborator rows are present for this researcher.</p> : <div className="grid gap-2 sm:grid-cols-2">{researcher.collaborators.map((collaborator) => <div key={`${collaborator.name}-${collaborator.sharedPapers}`} className="rounded-lg border border-white/8 bg-[#05070b] px-3 py-2"><div className="text-sm font-semibold text-slate-100">{collaborator.name}</div><div className="mt-1 text-xs text-slate-500">{collaborator.type || "unknown type"} · {collaborator.sharedPapers} shared papers</div></div>)}</div>}
              </div>
            </details>
            <details className="rounded-lg border border-white/8 bg-black/10">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-100">Raw profile snapshot</summary>
              <div className="border-t border-white/8 p-4">
                <pre className="overflow-x-auto rounded-lg bg-[#05070b] p-4 text-[11px] leading-6 text-slate-300">{JSON.stringify(rawSnapshot, null, 2)}</pre>
              </div>
            </details>
          </div>
        </section>
        <section className="mt-6"><h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.12em]"><FileText className="h-4 w-4 text-slate-400" />Top Matched Papers</h2><div className="rounded-xl border border-white/8 bg-white/[0.025] p-4">{researcher.papers.length === 0 ? <div className="py-12 text-center text-sm text-slate-500"><p>No matched works for this researcher.</p><a className="mt-4 inline-flex rounded-md border border-blue-500/30 px-3 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-500/10" href={googleScholarUrl(researcher)} target="_blank" rel="noreferrer">Search on Google Scholar</a></div> : <div className="space-y-3">{researcher.papers.map((paper) => <article key={paper.id} className="rounded-lg border border-white/8 bg-black/10 p-4"><div className="flex items-start justify-between gap-4"><div><a href={paperUrl(paper)} target="_blank" rel="noreferrer" className="text-sm font-semibold text-slate-100 hover:text-blue-300">{paper.title}<ExternalLink className="ml-1 inline h-3 w-3" /></a><p className="mt-1 text-xs text-slate-500">{paper.venue || "Unknown venue"} - {paper.year || "n/a"} - {paper.concept}</p><p className="mt-1 text-[10px] text-slate-600">{paper.id.startsWith("10.") ? `DOI: ${paper.id}` : paper.id}</p></div><div className="text-right"><div className="font-mono text-sm font-bold text-orange-400">{formatNumber(paper.recentCitations || 0)}</div><div className="text-[10px] text-slate-500">R cites</div><div className="mt-1 text-[10px] text-slate-600">{formatNumber(paper.citations)} lifetime</div></div></div>{paper.abstract && <p className="mt-3 line-clamp-3 text-xs leading-6 text-slate-500">{paper.abstract}</p>}</article>)}</div>}</div></section>
      </div>
    </main>
  );
}

export default function Home() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [activeQuery, setActiveQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchModeChoice>("auto");
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [detailId, setDetailId] = useState<string | undefined>();
  const [aiSummaryId, setAiSummaryId] = useState<string | undefined>();
  const [savedProfiles, setSavedProfiles] = useState<Record<string, ResearcherRecord>>(() => readStoredSavedProfiles());
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set(Object.keys(readStoredSavedProfiles())));
  const [aiAutoRequest, setAiAutoRequest] = useState<AiAutoRequest | undefined>();
  const [searchHistory, setSearchHistory] = useState<string[]>(() => [DEFAULT_QUERY, "quantum machine learning", "post-quantum cryptography", "thermal properties of materials"]);
  const [searchRunId, setSearchRunId] = useState(0);
  const [page, setPage] = useState(0);
  const [settings, setSettings] = useState<AppSettings>(() => readStoredSettings());
  const [accountAiSettings, setAccountAiSettings] = useState<AccountAiSettings | undefined>();
  const [accountAiSaving, setAccountAiSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode | undefined>();
  const [currentUser, setCurrentUser] = useState<CurrentUser | undefined>();
  const [researcherResults, setResearcherResults] = useState<ResearcherRecord[]>([]);
  const [searchMeta, setSearchMeta] = useState<SearchMeta | undefined>();
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [appliedYearRange, setAppliedYearRange] = useState({ minYear: defaultFilters.minYear, maxYear: defaultFilters.maxYear });
  const [tableSort, setTableSort] = useState<{ key: TableSortKey; direction: SortDirection }>({ key: "rank", direction: "asc" });
  useEffect(() => {
    persistSettings(settings);
  }, [settings]);
  useEffect(() => {
    persistSavedProfiles(savedProfiles);
  }, [savedProfiles]);
  useEffect(() => {
    apiRequest<{ user: CurrentUser | null }>("/api/auth/me").then((result) => setCurrentUser(result.user || undefined)).catch(() => setCurrentUser(undefined));
  }, []);
  useEffect(() => {
    if (!currentUser) return;
    apiRequest<{ savedIds: string[] }>("/api/saved-researchers").then((result) => setSavedIds((prev) => new Set([...Array.from(prev), ...result.savedIds]))).catch(() => undefined);
  }, [currentUser]);
  useEffect(() => {
    if (!currentUser) {
      setAccountAiSettings(undefined);
      return;
    }
    apiRequest<{ aiSettings?: AccountAiSettings }>("/api/user-settings").then((result) => {
      setAccountAiSettings(result.aiSettings);
      if (result.aiSettings) {
        setSettings((prev) => ({
          ...prev,
          aiProvider: result.aiSettings?.provider || prev.aiProvider,
          apiBaseUrl: result.aiSettings?.apiBaseUrl || prev.apiBaseUrl,
          model: result.aiSettings?.model || prev.model,
        }));
      }
    }).catch(() => setAccountAiSettings(undefined));
  }, [currentUser]);
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setAppliedYearRange({ minYear: filters.minYear, maxYear: filters.maxYear });
    }, 650);
    return () => window.clearTimeout(handle);
  }, [filters.minYear, filters.maxYear]);
  useEffect(() => {
    if (!activeQuery) return;
    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError("");
    setSearchMeta(undefined);
    setResearcherResults([]);
    fetchRankingResearchers(activeQuery, searchMode, appliedYearRange.minYear, appliedYearRange.maxYear, filters.weights, controller.signal)
      .then((result) => {
        setResearcherResults(result.researchers);
        setSearchMeta(result.meta);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSearchError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearchLoading(false);
      });
    return () => controller.abort();
  }, [activeQuery, searchRunId, searchMode, appliedYearRange.minYear, appliedYearRange.maxYear]);
  useEffect(() => {
    if (researcherResults.length === 0 || savedIds.size === 0) return;
    setSavedProfiles((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const researcher of researcherResults) {
        if (savedIds.has(researcher.id)) {
          next[researcher.id] = researcher;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [researcherResults, savedIds]);
  const countries = useMemo(() => Array.from(new Set(researcherResults.map((researcher) => researcher.country).filter((country) => country && country !== "Unknown"))).sort(), [researcherResults]);
  const scored = useMemo(() => {
    const filtered = researcherResults.filter((researcher) => filters.country === "All" || researcher.country === filters.country);
    const rNorm = normalizedMetricMap(filtered, (researcher) => researcher.recentCitations || 0, true);
    const base = filtered
      .map((researcher) => {
        const queryNorm = Math.min(100, Math.max(0, percentFromUnit(researcher.queryRelevanceScore ?? researcher.relevanceScore ?? researcherNameMatchScore(researcher, activeQuery))));
        const researchNorm = rNorm.get(researcher.id) || 0;
        const score = finalRankingScore(queryNorm, researchNorm, filters.weights);
        const rankedResearcher = { ...researcher, queryRelevanceNorm: queryNorm, recentCitationImpactNorm: researchNorm, finalScore: score };
        return { researcher: rankedResearcher, relevance: researcher.queryRelevanceScore ?? researcher.relevanceScore ?? 0, score };
      })
      .sort((a, b) => b.score - a.score || (b.researcher.queryRelevanceNorm || 0) - (a.researcher.queryRelevanceNorm || 0) || (b.researcher.recentCitationImpactNorm || 0) - (a.researcher.recentCitationImpactNorm || 0) || b.relevance - a.relevance);
    if (filters.pool === "top10") return base.slice(0, 10);
    if (filters.pool === "frontier") {
      const frontierIds = paretoIds(base.map((item) => item.researcher));
      return base.filter((item) => frontierIds.has(item.researcher.id));
    }
    return base;
  }, [activeQuery, researcherResults, filters]);
  const rankedList = useMemo(() => scored.map((item) => item.researcher), [scored]);
  const rankMap = useMemo(() => new Map(rankedList.map((researcher, index) => [researcher.id, index + 1])), [rankedList]);
  const sortedScored = useMemo(() => {
    const list = [...scored];
    if (tableSort.key === "rank") return tableSort.direction === "asc" ? list : list.reverse();
    const direction = tableSort.direction === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const diff = tableSortValue(a.researcher, tableSort.key) - tableSortValue(b.researcher, tableSort.key);
      return diff !== 0 ? diff * direction : b.score - a.score || b.relevance - a.relevance;
    });
  }, [scored, tableSort]);
  const resultList = sortedScored.map((item) => item.researcher);
  const totalPages = Math.max(1, Math.ceil(resultList.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const pagedResults = resultList.slice(pageStart, pageStart + PAGE_SIZE);
  const knownResearcherMap = useMemo(() => {
    const map = new Map<string, ResearcherRecord>();
    for (const researcher of Object.values(savedProfiles)) map.set(researcher.id, researcher);
    for (const researcher of researcherResults) map.set(researcher.id, researcher);
    for (const researcher of resultList) map.set(researcher.id, researcher);
    return map;
  }, [savedProfiles, researcherResults, resultList]);
  const selected = (selectedId ? knownResearcherMap.get(selectedId) : undefined) ?? pagedResults[0] ?? resultList[0];
  const detail = detailId ? knownResearcherMap.get(detailId) : undefined;
  const aiSummaryResearcher = aiSummaryId ? knownResearcherMap.get(aiSummaryId) : undefined;
  const savedResearchers = Array.from(savedIds).map((id) => knownResearcherMap.get(id)).filter((researcher): researcher is ResearcherRecord => Boolean(researcher));
  const runSearch = (nextQuery?: string) => { const value = (nextQuery ?? query).trim() || DEFAULT_QUERY; setQuery(value); setActiveQuery(value); setSearchRunId((id) => id + 1); setSelectedId(undefined); setPage(0); setFilters((prev) => ({ ...prev, pool: "pool" })); if (settings.searchHistory) setSearchHistory((prev) => [value, ...prev.filter((item) => item.toLowerCase() !== value.toLowerCase())].slice(0, 10)); };
  const changeTableSort = (key: TableSortKey) => {
    setTableSort((prev) => (prev.key === key ? { key, direction: prev.direction === "desc" ? "asc" : "desc" } : { key, direction: key === "rank" ? "asc" : "desc" }));
    setPage(0);
  };
  const toggleSave = (researcherOrId: ResearcherRecord | string) => setSavedIds((prev) => {
    const id = typeof researcherOrId === "string" ? researcherOrId : researcherOrId.id;
    const researcher = typeof researcherOrId === "string" ? knownResearcherMap.get(researcherOrId) : researcherOrId;
    const next = new Set(prev);
    if (next.has(id)) {
      next.delete(id);
      setSavedProfiles((profiles) => {
        const updated = { ...profiles };
        delete updated[id];
        return updated;
      });
    } else {
      next.add(id);
      if (researcher) setSavedProfiles((profiles) => ({ ...profiles, [id]: researcher }));
    }
    if (currentUser) {
      apiRequest<{ savedIds: string[] }>("/api/saved-researchers", { method: "PUT", body: JSON.stringify({ savedIds: Array.from(next) }) }).catch(() => undefined);
    }
    return next;
  });
  const askAiAboutResearcher = (researcher: ResearcherRecord) => {
    setSelectedId(researcher.id);
    setDetailId(undefined);
    setAiSummaryId(researcher.id);
    setAiAutoRequest({ id: Date.now(), researcherId: researcher.id, prompt: researcherAiPrompt(researcher, activeQuery) });
  };
  const saveAccountAiSettings = async () => {
    if (!currentUser) return;
    setAccountAiSaving(true);
    try {
      const result = await apiRequest<{ aiSettings: AccountAiSettings }>("/api/user-settings/ai", {
        method: "PUT",
        body: JSON.stringify({
          provider: settings.aiProvider,
          apiBaseUrl: settings.apiBaseUrl,
          model: settings.model,
          ...(settings.apiKey.trim() ? { apiKey: settings.apiKey.trim() } : {}),
        }),
      });
      setAccountAiSettings(result.aiSettings);
      if (settings.apiKey.trim()) {
        setSettings((prev) => {
          const savedApiKeys = { ...prev.savedApiKeys };
          delete savedApiKeys[prev.aiProvider];
          return { ...prev, apiKey: "", rememberApiKey: false, savedApiKeys, apiKeyStorageChoice: { ...prev.apiKeyStorageChoice, [prev.aiProvider]: "forget" } };
        });
      }
    } finally {
      setAccountAiSaving(false);
    }
  };
  const clearAccountAiKey = async () => {
    if (!currentUser) return;
    setAccountAiSaving(true);
    try {
      const result = await apiRequest<{ aiSettings: AccountAiSettings }>("/api/user-settings/ai", {
        method: "PUT",
        body: JSON.stringify({
          provider: settings.aiProvider,
          apiBaseUrl: settings.apiBaseUrl,
          model: settings.model,
          clearApiKey: true,
        }),
      });
      setAccountAiSettings(result.aiSettings);
    } finally {
      setAccountAiSaving(false);
    }
  };
  const logout = async () => {
    await apiRequest<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => ({ ok: true }));
    setCurrentUser(undefined);
    setSavedIds(new Set(Object.keys(readStoredSavedProfiles())));
  };
  const historyForSearch = settings.searchHistory ? searchHistory : [];
  const requestedSearchSource = "ranking backend";
  const displayedSearchSource = searchMeta?.sourceLabel || requestedSearchSource;
  const emptyState = searchError || (searchLoading ? `Searching ${requestedSearchSource}... first request can take up to a minute while the backend wakes up.` : `No researchers found for this query from ${displayedSearchSource}.`);
  const interfaceScale = Math.min(125, Math.max(80, Number(settings.interfaceScale) || 100));
  const uiScale = interfaceScale / 100;
  const appScaleStyle = {
    "--ui-scale": String(uiScale),
    "--filter-rail-width": `${Math.round(Math.min(320, Math.max(220, 260 * uiScale)))}px`,
    "--side-summary-width": `${Math.round(Math.min(280, Math.max(220, 260 * uiScale)))}px`,
    "--researcher-table-min-width": `${Math.round(Math.min(760, Math.max(560, 620 * uiScale)))}px`,
    "--floating-chat-width": `${Math.round(560 * uiScale)}px`,
    "--floating-chat-height": `${Math.round(640 * uiScale)}px`,
    fontSize: `${interfaceScale}%`,
  } as React.CSSProperties & Record<string, string>;
  const content = aiSummaryResearcher ? (
    <AiSummaryPage researcher={aiSummaryResearcher} isSaved={savedIds.has(aiSummaryResearcher.id)} user={currentUser} query={activeQuery} list={pagedResults} settings={settings} autoRequest={aiAutoRequest} onToggleSave={() => toggleSave(aiSummaryResearcher)} onOpenDetail={() => { setAiSummaryId(undefined); setDetailId(aiSummaryResearcher.id); }} onBack={() => setAiSummaryId(undefined)} onLogout={logout} onOpenSettings={() => setSettingsOpen(true)} onOpenAuth={setAuthMode} />
  ) : detail ? (
    <DetailPage researcher={detail} isSaved={savedIds.has(detail.id)} user={currentUser} weights={filters.weights} onToggleSave={() => toggleSave(detail)} onAskAi={() => askAiAboutResearcher(detail)} onBack={() => setDetailId(undefined)} onLogout={logout} onOpenSettings={() => setSettingsOpen(true)} onOpenAuth={setAuthMode} />
  ) : !activeQuery ? (
    <LandingPage query={query} setQuery={setQuery} onSearch={runSearch} history={historyForSearch} searchMode={searchMode} setSearchMode={setSearchMode} settings={settings} user={currentUser} onLogout={logout} onOpenSettings={() => setSettingsOpen(true)} onOpenAuth={setAuthMode} />
  ) : (
    <main className="flex h-screen flex-col overflow-hidden bg-[#05070b] text-slate-100">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-white/8 bg-[#070a10] px-4"><button className="flex items-center gap-2 text-sm font-bold" onClick={() => { setActiveQuery(""); setDetailId(undefined); setAiSummaryId(undefined); }}><BrandMark compact />{BRAND_NAME}</button><SearchInputWithHistory query={query} setQuery={setQuery} onSearch={runSearch} history={historyForSearch} searchMode={searchMode} setSearchMode={setSearchMode} compact /><button onClick={() => runSearch()} className="rounded-full bg-blue-600 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-500">Search</button><div className="ml-auto"><TopActions user={currentUser} onLogout={logout} onOpenSettings={() => setSettingsOpen(true)} onOpenAuth={setAuthMode} /></div></header>
      <div className="flex min-h-0 flex-1">
        <FilterRail filters={filters} setFilters={setFilters} countries={countries} selected={selected} savedResearchers={savedResearchers} chartList={rankedList} rankMap={rankMap} onSelect={(researcher) => setSelectedId(researcher.id)} onToggleSave={toggleSave} />
        <section className="flex min-w-0 flex-1 flex-col">
          <ResearcherTable list={pagedResults} selected={selected} savedIds={savedIds} startRank={pageStart + 1} emptyState={emptyState} sort={tableSort} onSort={changeTableSort} onSelect={(researcher) => setSelectedId(researcher.id)} onOpenDetail={(researcher) => setDetailId(researcher.id)} onToggleSave={toggleSave} onAskAi={askAiAboutResearcher} />
          <PaginationBar page={currentPage} total={resultList.length} onPageChange={setPage} />
        </section>
        <SideSummary researcher={selected} isSaved={selected ? savedIds.has(selected.id) : false} onToggleSave={() => selected && toggleSave(selected)} onOpenDetail={() => selected && setDetailId(selected.id)} onAskAi={() => selected && askAiAboutResearcher(selected)} />
      </div>
    </main>
  );
  return (
    <div className={cn(settings.theme === "light" && "theme-light")} style={appScaleStyle}>
      {content}
      <SettingsModal open={settingsOpen} settings={settings} user={currentUser} accountAiSettings={accountAiSettings} accountAiSaving={accountAiSaving} onClose={() => setSettingsOpen(false)} onChange={setSettings} onSaveAccountAi={saveAccountAiSettings} onClearAccountAi={clearAccountAiKey} />
      <AuthModal mode={authMode} onClose={() => setAuthMode(undefined)} onModeChange={setAuthMode} onAuthenticated={setCurrentUser} />
    </div>
  );
}

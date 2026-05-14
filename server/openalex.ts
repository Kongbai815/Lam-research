import type { ResearcherRecord, ResearchPaper } from "../client/src/lib/data";

const OPENALEX_BASE_URL = "https://api.openalex.org";
const DEFAULT_QUERY = "quantum computing algorithms";
const DEFAULT_PER_PAGE = 50;
const MAX_WORKS_PER_QUERY = 100;
const MAX_AUTHORS_TO_HYDRATE = 80;
const CURRENT_YEAR = new Date().getFullYear();

type SearchMode = "author" | "institution" | "topic";
type RequestedSearchMode = SearchMode | "auto";
type MatchSource = "exact-name" | "author-search" | "institution-search" | "works-search" | "topic-relevance";

type JsonResponse = {
  writeHead: (status: number, headers: Record<string, string>) => void;
  end: (body: string) => void;
};

interface OpenAlexListResponse<T> {
  meta?: {
    count?: number;
    page?: number;
    per_page?: number;
    db_response_time_ms?: number;
  };
  results?: T[];
}

interface OpenAlexInstitution {
  id?: string;
  display_name?: string;
  display_name_acronyms?: string[];
  relevance_score?: number;
  country_code?: string;
  type?: string;
}

interface OpenAlexTopic {
  id?: string;
  display_name?: string;
  count?: number;
  score?: number;
  subfield?: { display_name?: string };
  field?: { display_name?: string };
  domain?: { display_name?: string };
}

interface OpenAlexAuthorship {
  author_position?: string;
  author?: {
    id?: string;
    display_name?: string;
  };
  institutions?: OpenAlexInstitution[];
  countries?: string[];
}

interface OpenAlexWork {
  id?: string;
  doi?: string;
  display_name?: string;
  title?: string;
  publication_year?: number;
  cited_by_count?: number;
  counts_by_year?: Array<{
    year?: number;
    cited_by_count?: number;
  }>;
  relevance_score?: number;
  type?: string;
  abstract_inverted_index?: Record<string, number[]>;
  primary_location?: {
    landing_page_url?: string;
    source?: {
      display_name?: string;
      type?: string;
    };
  };
  primary_topic?: OpenAlexTopic;
  topics?: OpenAlexTopic[];
  authorships?: OpenAlexAuthorship[];
}

interface OpenAlexAuthor {
  id?: string;
  display_name?: string;
  works_count?: number;
  cited_by_count?: number;
  summary_stats?: {
    h_index?: number;
    i10_index?: number;
  };
  last_known_institutions?: OpenAlexInstitution[];
  affiliations?: Array<{
    institution?: OpenAlexInstitution;
    years?: number[];
  }>;
  topics?: OpenAlexTopic[];
}

interface AggregatedAuthor {
  id: string;
  name: string;
  institution?: OpenAlexInstitution;
  countries: Set<string>;
  works: Array<{ work: OpenAlexWork; position: number }>;
  coauthors: Map<string, number>;
  relevance: number;
  queryRelevance: number;
  matchSource: MatchSource;
  matchReason: string;
  searchMode: SearchMode;
}

function jsonResponse(res: JsonResponse, status: number, payload: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function compactOpenAlexId(value: string | undefined) {
  return value?.replace(/^https:\/\/openalex\.org\//, "") || "";
}

function cleanDoi(value: string | undefined) {
  return value?.replace(/^https:\/\/doi\.org\//, "") || "";
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function matchSourcePriority(source: MatchSource) {
  if (source === "exact-name") return 5;
  if (source === "author-search") return 4;
  if (source === "institution-search") return 3;
  if (source === "topic-relevance") return 2;
  return 1;
}

function setMatch(author: AggregatedAuthor, source: MatchSource, reason: string, searchMode: SearchMode) {
  if (matchSourcePriority(source) >= matchSourcePriority(author.matchSource)) {
    author.matchSource = source;
    author.matchReason = reason;
    author.searchMode = searchMode;
  }
}

function buildUrl(pathname: string, params: Record<string, string | number | undefined>) {
  const url = new URL(pathname, OPENALEX_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && String(value).trim()) {
      url.searchParams.set(key, String(value));
    }
  }
  const apiKey = process.env.OPENALEX_API_KEY?.trim();
  if (apiKey) url.searchParams.set("api_key", apiKey);
  return url;
}

function extractAbstract(index: Record<string, number[]> | undefined) {
  if (!index) return "";
  const words: Array<{ word: string; position: number }> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words.push({ word, position });
  }
  return words
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.word)
    .join(" ")
    .slice(0, 900);
}

function primaryTopicFromWork(work: OpenAlexWork) {
  const topic = work.primary_topic || work.topics?.[0];
  return {
    topic: topic?.display_name || "General research",
    subfield: topic?.subfield?.display_name || "",
    field: topic?.field?.display_name || "",
    domain: topic?.domain?.display_name || "",
  };
}

function primaryTopicFromAuthor(author: OpenAlexAuthor | undefined, fallbackWork: OpenAlexWork | undefined) {
  const topic = author?.topics?.[0];
  if (topic?.display_name) {
    return {
      topic: topic.display_name,
      subfield: topic.subfield?.display_name || "",
      field: topic.field?.display_name || "",
      domain: topic.domain?.display_name || "",
      topics: author?.topics?.map((item) => item.display_name).filter(Boolean).slice(0, 8) as string[],
    };
  }
  const fallback = primaryTopicFromWork(fallbackWork || {});
  return { ...fallback, topics: fallback.topic ? [fallback.topic] : [] };
}

async function fetchOpenAlex<T>(url: URL) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ResearchAI/1.0 (OpenAlex integration)",
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : typeof data?.message === "string" ? data.message : `OpenAlex request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  return data as T;
}

function workFilters() {
  return ["is_retracted:false"];
}

async function fetchWorksByFilter(filter: string) {
  const filters = [...workFilters(), filter];
  const url = buildUrl("/works", {
    filter: filters.join(","),
    sort: "cited_by_count:desc",
    per_page: Math.min(MAX_WORKS_PER_QUERY, Math.max(DEFAULT_PER_PAGE, 1)),
    select: "id,doi,display_name,title,publication_year,cited_by_count,counts_by_year,relevance_score,type,abstract_inverted_index,primary_location,primary_topic,topics,authorships",
  });
  return fetchOpenAlex<OpenAlexListResponse<OpenAlexWork>>(url);
}

async function fetchWorksForAuthors(authorIds: string[]) {
  const ids = authorIds.map(compactOpenAlexId).filter(Boolean).slice(0, 10);
  if (ids.length === 0) return { results: [], meta: { count: 0, per_page: 0 } } satisfies OpenAlexListResponse<OpenAlexWork>;
  return fetchWorksByFilter(`author.id:${ids.join("|")}`);
}

async function fetchWorksForInstitutions(institutionIds: string[]) {
  const ids = institutionIds.map(compactOpenAlexId).filter(Boolean).slice(0, 5);
  if (ids.length === 0) return { results: [], meta: { count: 0, per_page: 0 } } satisfies OpenAlexListResponse<OpenAlexWork>;
  return fetchWorksByFilter(`institutions.id:${ids.join("|")}`);
}

async function fetchWorksBySearch(query: string) {
  const filters = workFilters();
  const url = buildUrl("/works", {
    search: query,
    filter: filters.join(","),
    sort: "relevance_score:desc,cited_by_count:desc",
    per_page: Math.min(MAX_WORKS_PER_QUERY, Math.max(DEFAULT_PER_PAGE, 1)),
    select: "id,doi,display_name,title,publication_year,cited_by_count,counts_by_year,relevance_score,type,abstract_inverted_index,primary_location,primary_topic,topics,authorships",
  });
  return fetchOpenAlex<OpenAlexListResponse<OpenAlexWork>>(url);
}

async function fetchAuthors(ids: string[]) {
  if (ids.length === 0) return new Map<string, OpenAlexAuthor>();
  const url = buildUrl("/authors", {
    filter: `openalex_id:${ids.map(compactOpenAlexId).join("|")}`,
    per_page: ids.length,
    select: "id,display_name,works_count,cited_by_count,summary_stats,last_known_institutions,affiliations,topics",
  });
  const data = await fetchOpenAlex<OpenAlexListResponse<OpenAlexAuthor>>(url);
  return new Map((data.results || []).map((author) => [compactOpenAlexId(author.id), author]));
}

function normalizedQueryTokens(query: string) {
  return query
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function normalizedSearchText(query: string) {
  return normalizedQueryTokens(query).join(" ");
}

const TOPIC_WORDS = new Set([
  "ai",
  "algorithm",
  "algorithms",
  "artificial",
  "biology",
  "chemistry",
  "computing",
  "data",
  "deep",
  "graph",
  "health",
  "intelligence",
  "learning",
  "machine",
  "material",
  "materials",
  "model",
  "models",
  "nano",
  "network",
  "networks",
  "neural",
  "physics",
  "properties",
  "quantum",
  "robotics",
  "science",
  "synthesis",
]);

function looksLikePersonQuery(query: string) {
  const tokens = normalizedQueryTokens(query);
  if (tokens.length < 2 || tokens.length > 5) return false;
  return tokens.every((token) => !TOPIC_WORDS.has(token));
}

function looksLikeInstitutionQuery(query: string) {
  const trimmed = query.trim();
  const normalized = normalizedSearchText(trimmed);
  const institutionWords = /\b(university|college|institute|school|hospital|laboratory|lab|center|centre|academy|polytechnic|department)\b/i;
  if (institutionWords.test(trimmed)) return true;
  if (/^[A-Z][A-Z0-9&.-]{1,9}$/.test(trimmed) && !/^(AI|ML|NLP|LLM|CPU|GPU)$/i.test(trimmed)) return true;
  return ["mit", "caltech", "eth", "cmu", "ucl", "epfl", "nus", "ntu"].includes(normalized);
}

function detectSearchMode(query: string): SearchMode {
  if (looksLikeInstitutionQuery(query)) return "institution";
  if (looksLikePersonQuery(query)) return "author";
  return "topic";
}

function normalizeRequestedSearchMode(value: string | null): RequestedSearchMode | undefined {
  if (value === "auto" || value === "author" || value === "institution" || value === "topic") return value;
  return undefined;
}

function exactAuthorNameMatch(authorName: string | undefined, query: string) {
  if (!authorName) return false;
  const authorText = normalizedSearchText(authorName);
  const queryText = normalizedSearchText(query);
  if (!authorText || !queryText) return false;
  if (authorText === queryText) return true;
  const authorTokens = new Set(normalizedQueryTokens(authorName));
  const queryTokens = normalizedQueryTokens(query);
  return queryTokens.length > 1 && queryTokens.every((token) => authorTokens.has(token));
}

function exactInstitutionMatch(institution: OpenAlexInstitution, query: string) {
  const queryText = normalizedSearchText(query);
  if (!queryText) return false;
  const names = [institution.display_name, ...(institution.display_name_acronyms || [])]
    .map((name) => normalizedSearchText(name || ""))
    .filter(Boolean);
  return names.includes(queryText);
}

function narrowInstitutionMatches(institutions: OpenAlexInstitution[], query: string) {
  const exactMatches = institutions.filter((institution) => exactInstitutionMatch(institution, query));
  return exactMatches.length > 0 ? exactMatches : institutions;
}

function sourceLabel(mode: SearchMode) {
  if (mode === "author") return "Author search";
  if (mode === "institution") return "Institution search";
  return "Works/topic search";
}

async function fetchAuthorsBySearch(query: string, force = false) {
  if (!force && !looksLikePersonQuery(query)) return [];
  const url = buildUrl("/authors", {
    search: query,
    per_page: 10,
    select: "id,display_name,works_count,cited_by_count,summary_stats,last_known_institutions,affiliations,topics",
  });
  const data = await fetchOpenAlex<OpenAlexListResponse<OpenAlexAuthor>>(url);
  return data.results || [];
}

async function fetchInstitutionsBySearch(query: string) {
  const url = buildUrl("/institutions", {
    search: query,
    per_page: 5,
    select: "id,display_name,display_name_acronyms,country_code,type,relevance_score",
  });
  const data = await fetchOpenAlex<OpenAlexListResponse<OpenAlexInstitution>>(url);
  return data.results || [];
}

function upsertAuthor(map: Map<string, AggregatedAuthor>, work: OpenAlexWork, authorship: OpenAlexAuthorship, position: number, source: MatchSource, reason: string, searchMode: SearchMode, matchedInstitution?: OpenAlexInstitution) {
  const authorId = compactOpenAlexId(authorship.author?.id);
  const name = authorship.author?.display_name;
  if (!authorId || !name) return;
  const institutions = authorship.institutions || [];
  const displayInstitution = matchedInstitution || institutions[0];
  const existing = map.get(authorId);
  const current =
    existing ||
    ({
      id: authorId,
      name,
      institution: displayInstitution,
      countries: new Set<string>(),
      works: [],
      coauthors: new Map<string, number>(),
      relevance: 0,
      queryRelevance: 0,
      matchSource: source,
      matchReason: reason,
      searchMode,
    } satisfies AggregatedAuthor);
  if (existing) setMatch(current, source, reason, searchMode);
  if (searchMode === "institution" && matchedInstitution) current.institution = matchedInstitution;
  if (!current.institution && displayInstitution) current.institution = displayInstitution;
  if (displayInstitution?.country_code) current.countries.add(displayInstitution.country_code);
  for (const country of authorship.countries || []) current.countries.add(country);
  current.works.push({ work, position });
  current.relevance += numberValue(work.relevance_score) + numberValue(work.cited_by_count) * 0.02 + Math.max(0, 12 - position);
  current.queryRelevance += numberValue(work.relevance_score) + Math.max(0, 12 - position);
  for (const coauthor of work.authorships || []) {
    const coauthorName = coauthor.author?.display_name;
    if (coauthorName && coauthorName !== name) current.coauthors.set(coauthorName, (current.coauthors.get(coauthorName) || 0) + 1);
  }
  map.set(authorId, current);
}

function citationsInRange(work: OpenAlexWork, startYear: number, endYear: number) {
  return (work.counts_by_year || []).reduce((sum, entry) => {
    const year = numberValue(entry.year);
    if (year < startYear || year > endYear) return sum;
    return sum + numberValue(entry.cited_by_count);
  }, 0);
}

function yearlyCitationCounts(work: OpenAlexWork) {
  return (work.counts_by_year || [])
    .map((entry) => ({ year: numberValue(entry.year), citations: numberValue(entry.cited_by_count) }))
    .filter((entry) => entry.year > 0)
    .sort((a, b) => b.year - a.year);
}

function toResearchPaper(work: OpenAlexWork, citationStartYear: number, citationEndYear: number): ResearchPaper {
  const topic = primaryTopicFromWork(work);
  return {
    id: cleanDoi(work.doi) || compactOpenAlexId(work.id),
    title: work.display_name || work.title || "Untitled work",
    year: numberValue(work.publication_year),
    venue: work.primary_location?.source?.display_name || "Unknown venue",
    venueType: work.primary_location?.source?.type || work.type || "unknown",
    citations: numberValue(work.cited_by_count),
    recentCitations: citationsInRange(work, citationStartYear, citationEndYear),
    citationYearCounts: yearlyCitationCounts(work),
    concept: topic.topic,
    abstract: extractAbstract(work.abstract_inverted_index),
    embeddingId: compactOpenAlexId(work.id),
    url: work.doi || work.primary_location?.landing_page_url || work.id,
  };
}

function toResearcherRecord(aggregated: AggregatedAuthor, author: OpenAlexAuthor | undefined, citationStartYear: number, citationEndYear: number): ResearcherRecord {
  const matchedInstitution = aggregated.searchMode === "institution" ? aggregated.institution : undefined;
  const currentInstitution = author?.last_known_institutions?.[0] || author?.affiliations?.[0]?.institution;
  const institution =
    aggregated.searchMode === "institution"
      ? matchedInstitution || currentInstitution
      : currentInstitution || aggregated.institution;
  const firstWork = aggregated.works[0]?.work;
  const topic = primaryTopicFromAuthor(author, firstWork);
  const papers = aggregated.works
    .sort((a, b) => numberValue(b.work.cited_by_count) - numberValue(a.work.cited_by_count))
    .slice(0, 8)
    .map(({ work }) => toResearchPaper(work, citationStartYear, citationEndYear));
  const years = papers.map((paper) => paper.year).filter((year) => year > 0);
  const careerStartYear = author?.affiliations?.flatMap((affiliation) => affiliation.years || []).sort((a, b) => a - b)[0] || (years.length ? Math.min(...years) : CURRENT_YEAR);
  const hIndex = numberValue(author?.summary_stats?.h_index);
  const totalCitations = numberValue(author?.cited_by_count) || papers.reduce((sum, paper) => sum + paper.citations, 0);
  const recentCitations = aggregated.works.reduce((sum, entry) => sum + citationsInRange(entry.work, citationStartYear, citationEndYear), 0);
  const totalWorks = numberValue(author?.works_count) || aggregated.works.length;
  const collaborators = Array.from(aggregated.coauthors.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, sharedPapers]) => ({ name, sharedPapers, type: "OpenAlex coauthor" }));
  const recencyScore = years.length ? Math.max(0, 100 - Math.max(0, CURRENT_YEAR - Math.max(...years)) * 8) : 0;
  const qScore = Math.round(Math.min(100, Math.max(0, aggregated.queryRelevance || aggregated.relevance)));
  const seniorityScore = Math.min(100, Math.max(0, CURRENT_YEAR - careerStartYear) * 3);

  return {
    id: aggregated.id,
    name: author?.display_name || aggregated.name,
    initials: "",
    institution: institution?.display_name || "Unknown institution",
    institutionId: compactOpenAlexId(institution?.id),
    matchedInstitution: matchedInstitution?.display_name,
    matchedInstitutionId: compactOpenAlexId(matchedInstitution?.id),
    matchedInstitutionCountry: matchedInstitution?.country_code,
    currentInstitution: currentInstitution?.display_name,
    currentInstitutionId: compactOpenAlexId(currentInstitution?.id),
    currentInstitutionCountry: currentInstitution?.country_code,
    country: institution?.country_code || Array.from(aggregated.countries)[0] || "",
    region: "",
    totalWorks,
    totalCitations,
    recentCitations,
    citationStartYear,
    citationEndYear,
    hIndex,
    i10Index: numberValue(author?.summary_stats?.i10_index),
    careerStartYear,
    yearsActive: Math.max(1, CURRENT_YEAR - careerStartYear + 1),
    qScore,
    recencyScore,
    seniorityScore,
    compositeScore: qScore,
    primaryTopic: topic.topic,
    topics: topic.topics?.length ? topic.topics : [topic.topic].filter(Boolean),
    subfield: topic.subfield,
    field: topic.field,
    domain: topic.domain,
    authorUrl: `https://openalex.org/${aggregated.id}`,
    googleUrl: `https://www.google.com/search?q=${encodeURIComponent(`${author?.display_name || aggregated.name} ${institution?.display_name || ""}`)}`,
    scholarUrl: `https://scholar.google.com/scholar?q=${encodeURIComponent(author?.display_name || aggregated.name)}`,
    coAuthorCount: collaborators.length,
    papers,
    collaborators,
    affiliation: institution?.display_name || "Unknown institution",
    role: topic.topic,
    avatar: "",
    keywords: topic.topics?.length ? topic.topics : [topic.topic].filter(Boolean),
    relevanceScore: Math.round(aggregated.relevance),
    queryRelevanceScore: Math.round(aggregated.queryRelevance || aggregated.relevance),
    whyMatched: aggregated.matchReason,
    matchSource: aggregated.matchSource,
    matchReason: aggregated.matchReason,
    searchMode: aggregated.searchMode,
    aiSummary: `${author?.display_name || aggregated.name} is indexed in OpenAlex for ${topic.topic}.`,
    fullBio:
      aggregated.searchMode === "institution" && matchedInstitution?.display_name
        ? `${author?.display_name || aggregated.name} matched ${matchedInstitution.display_name} through OpenAlex authorship affiliations. Current/last-known institution may differ because researchers can move between institutions.`
        : `${author?.display_name || aggregated.name} has ${totalWorks} OpenAlex works and ${totalCitations} citations. Latest matched papers are drawn directly from OpenAlex.`,
    topPapers: papers,
    researchThemes: topic.topics?.length ? topic.topics : [topic.topic].filter(Boolean),
    relatedResearchers: collaborators.map((collaborator) => collaborator.name),
    publications: totalWorks,
  };
}

function normalizedIdentityTokens(query: string) {
  return query
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function tokenDistance(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function nearToken(a: string, b: string) {
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5) return tokenDistance(a, b) <= 1;
  return false;
}

function authorVariantMatchesQuery(researcher: ResearcherRecord, query: string) {
  const queryTokens = normalizedIdentityTokens(query);
  const nameTokens = normalizedIdentityTokens(researcher.name);
  const longQueryTokens = queryTokens.filter((token) => token.length > 1);
  if (longQueryTokens.length < 2 || nameTokens.length === 0) return false;
  const querySurname = longQueryTokens[longQueryTokens.length - 1];
  const hasSurname = nameTokens.some((token) => nearToken(token, querySurname));
  const sharedLongTokens = longQueryTokens.filter((queryToken) => nameTokens.some((nameToken) => nearToken(queryToken, nameToken))).length;
  const initialMatches = longQueryTokens.some((queryToken) => nameTokens.some((nameToken) => nameToken.length === 1 && queryToken.startsWith(nameToken)));
  return hasSurname && (sharedLongTokens >= Math.min(2, longQueryTokens.length) || (sharedLongTokens >= 1 && initialMatches));
}

function normalizedInstitutionName(value: string | undefined) {
  const text = value?.trim().toLowerCase() || "";
  return text && text !== "unknown institution" ? text : "";
}

function isUnknownInstitution(value: string | undefined) {
  return !normalizedInstitutionName(value);
}

function choosePrimaryAuthorVariant(records: ResearcherRecord[], query: string) {
  return [...records].sort((a, b) => {
    const exactA = exactAuthorNameMatch(a.name, query) ? 1 : 0;
    const exactB = exactAuthorNameMatch(b.name, query) ? 1 : 0;
    return exactB - exactA || b.totalCitations - a.totalCitations || b.hIndex - a.hIndex || b.totalWorks - a.totalWorks || (b.relevanceScore || 0) - (a.relevanceScore || 0);
  })[0];
}

function shouldMergeAuthorVariant(candidate: ResearcherRecord, primary: ResearcherRecord, query: string) {
  if (candidate.id === primary.id) return true;
  if (!authorVariantMatchesQuery(candidate, query) && !exactAuthorNameMatch(candidate.name, query)) return false;
  const candidateInstitution = normalizedInstitutionName(candidate.institution);
  const primaryInstitution = normalizedInstitutionName(primary.institution);
  const sameInstitution = Boolean(candidateInstitution && primaryInstitution && candidateInstitution === primaryInstitution);
  const smallSplitProfile = candidate.totalWorks <= 12 || candidate.totalCitations <= 1200 || candidate.hIndex <= 5;
  const sameDisplayedName = exactAuthorNameMatch(candidate.name, primary.name);
  return sameInstitution || smallSplitProfile || (sameDisplayedName && (isUnknownInstitution(candidate.institution) || isUnknownInstitution(primary.institution)));
}

function uniqueTextValues(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function mergePapers(a: ResearchPaper[], b: ResearchPaper[]) {
  const papers = new Map<string, ResearchPaper>();
  for (const paper of [...a, ...b]) {
    const key = (paper.id || `${paper.title}-${paper.year}`).toLowerCase();
    const existing = papers.get(key);
    if (!existing || paper.citations > existing.citations) papers.set(key, paper);
  }
  return Array.from(papers.values())
    .sort((left, right) => right.citations - left.citations || right.year - left.year)
    .slice(0, 16);
}

function mergeCollaborators(a: ResearcherRecord["collaborators"], b: ResearcherRecord["collaborators"]) {
  const collaborators = new Map<string, { name: string; type: string; sharedPapers: number }>();
  for (const collaborator of [...(a || []), ...(b || [])]) {
    const key = collaborator.name.toLowerCase();
    const existing = collaborators.get(key);
    if (existing) {
      existing.sharedPapers += collaborator.sharedPapers;
    } else {
      collaborators.set(key, { ...collaborator });
    }
  }
  return Array.from(collaborators.values())
    .sort((left, right) => right.sharedPapers - left.sharedPapers)
    .slice(0, 12);
}

function bestMatchSource(a: ResearcherRecord["matchSource"], b: ResearcherRecord["matchSource"]) {
  const left = (a || "works-search") as MatchSource;
  const right = (b || "works-search") as MatchSource;
  return matchSourcePriority(right) > matchSourcePriority(left) ? right : left;
}

function mergeResearcherRecords(target: ResearcherRecord, source: ResearcherRecord) {
  const institution = isUnknownInstitution(target.institution) && !isUnknownInstitution(source.institution) ? source.institution : target.institution;
  const institutionId = target.institutionId || source.institutionId;
  const papers = mergePapers(target.papers || [], source.papers || []);
  const collaborators = mergeCollaborators(target.collaborators, source.collaborators);
  const careerStartYear = Math.min(...[target.careerStartYear, source.careerStartYear].filter((year) => year > 0));
  const topics = uniqueTextValues([...(target.topics || []), ...(source.topics || []), target.primaryTopic, source.primaryTopic]);
  const researchThemes = uniqueTextValues([...(target.researchThemes || []), ...(source.researchThemes || []), ...(target.keywords || []), ...(source.keywords || [])]);
  const totalWorks = target.totalWorks + source.totalWorks;
  const totalCitations = target.totalCitations + source.totalCitations;
  const recentCitations = (target.recentCitations || 0) + (source.recentCitations || 0);
  const i10Index = target.i10Index + source.i10Index;
  const hIndex = Math.max(target.hIndex, source.hIndex);
  const recencyScore = Math.max(target.recencyScore || 0, source.recencyScore || 0);
  return {
    ...target,
    institution,
    institutionId,
    country: target.country || source.country,
    totalWorks,
    totalCitations,
    recentCitations,
    citationStartYear: target.citationStartYear || source.citationStartYear,
    citationEndYear: target.citationEndYear || source.citationEndYear,
    hIndex,
    i10Index,
    careerStartYear,
    yearsActive: Math.max(1, CURRENT_YEAR - careerStartYear + 1),
    qScore: Math.max(target.qScore, source.qScore),
    recencyScore,
    seniorityScore: Math.max(target.seniorityScore || 0, source.seniorityScore || 0),
    compositeScore: Math.max(target.compositeScore, source.compositeScore),
    topics,
    keywords: researchThemes.length ? researchThemes : topics,
    researchThemes: researchThemes.length ? researchThemes : topics,
    papers,
    topPapers: papers,
    collaborators,
    coAuthorCount: collaborators.length,
    relatedResearchers: collaborators.map((collaborator) => collaborator.name),
    affiliation: institution,
    publications: totalWorks,
    relevanceScore: (target.relevanceScore || 0) + (source.relevanceScore || 0),
    queryRelevanceScore: (target.queryRelevanceScore || 0) + (source.queryRelevanceScore || 0),
    matchSource: bestMatchSource(target.matchSource, source.matchSource),
  } satisfies ResearcherRecord;
}

function mergeAuthorSearchResults(researchers: ResearcherRecord[], query: string) {
  const candidates = researchers.filter((researcher) => authorVariantMatchesQuery(researcher, query) || exactAuthorNameMatch(researcher.name, query));
  if (candidates.length <= 1) return researchers;
  const primary = choosePrimaryAuthorVariant(candidates, query);
  const mergeGroup = candidates.filter((candidate) => shouldMergeAuthorVariant(candidate, primary, query));
  if (mergeGroup.length <= 1) return researchers;
  const merged = mergeGroup
    .filter((candidate) => candidate.id !== primary.id)
    .reduce((record, candidate) => mergeResearcherRecords(record, candidate), { ...primary, papers: [...(primary.papers || [])], topPapers: [...(primary.topPapers || primary.papers || [])], collaborators: [...(primary.collaborators || [])] });
  const mergedIds = new Set(mergeGroup.map((candidate) => candidate.id));
  const mergedRecord = {
    ...merged,
    whyMatched: `Merged ${mergeGroup.length} OpenAlex author records for the name search "${query}". H-index uses the strongest profile; works, citations, i10-index, matched papers, topics, and collaborators are aggregated.`,
    matchReason: `Merged ${mergeGroup.length} OpenAlex author records for the name search "${query}".`,
    aiSummary: `${merged.name} combines ${mergeGroup.length} OpenAlex author records that appear to describe the same researcher.`,
    fullBio: `${merged.name} combines ${mergeGroup.length} OpenAlex author records. H-index is kept as the maximum observed H-index because H-index is not additive; works, citations, i10-index, matched papers, topics, and collaborators are aggregated.`,
  } satisfies ResearcherRecord;
  return [mergedRecord, ...researchers.filter((researcher) => !mergedIds.has(researcher.id))]
    .sort((a, b) => matchSourcePriority((b.matchSource || "works-search") as MatchSource) - matchSourcePriority((a.matchSource || "works-search") as MatchSource) || (b.relevanceScore || 0) - (a.relevanceScore || 0) || b.totalCitations - a.totalCitations)
    .slice(0, MAX_AUTHORS_TO_HYDRATE);
}

export async function resolveOpenAlexResearchers(params: { query?: string; minYear?: number; maxYear?: number; citationStartYear?: number; citationEndYear?: number; mode?: RequestedSearchMode }) {
  const query = params.query?.trim() || DEFAULT_QUERY;
  const citationStartYear = Math.max(1800, Math.min(CURRENT_YEAR + 1, Math.round(params.citationStartYear || params.minYear || 2020)));
  const citationEndYear = Math.max(citationStartYear, Math.min(CURRENT_YEAR + 1, Math.round(params.citationEndYear || params.maxYear || CURRENT_YEAR + 1)));
  const searchMode = params.mode && params.mode !== "auto" ? params.mode : detectSearchMode(query);
  let searchedAuthors: OpenAlexAuthor[] = [];
  let searchedInstitutions: OpenAlexInstitution[] = [];
  let worksResponse: OpenAlexListResponse<OpenAlexWork>;

  if (searchMode === "author") {
    searchedAuthors = await fetchAuthorsBySearch(query, true);
    worksResponse = await fetchWorksForAuthors(searchedAuthors.map((author) => author.id || ""));
    if ((worksResponse.results || []).length === 0) worksResponse = await fetchWorksBySearch(query);
  } else if (searchMode === "institution") {
    searchedInstitutions = narrowInstitutionMatches(await fetchInstitutionsBySearch(query), query);
    worksResponse = await fetchWorksForInstitutions(searchedInstitutions.map((institution) => institution.id || ""));
    if ((worksResponse.results || []).length === 0) worksResponse = await fetchWorksBySearch(query);
  } else {
    worksResponse = await fetchWorksBySearch(query);
  }

  const authors = new Map<string, AggregatedAuthor>();
  const searchedAuthorIds = new Set(searchedAuthors.map((author) => compactOpenAlexId(author.id)).filter(Boolean));
  const searchedInstitutionIds = new Set(searchedInstitutions.map((institution) => compactOpenAlexId(institution.id)).filter(Boolean));
  const institutionNames = searchedInstitutions.map((institution) => institution.display_name).filter(Boolean).slice(0, 3).join(", ");

  for (const work of worksResponse.results || []) {
    let authorships = (work.authorships || []).slice(0, 8);
    if (searchMode === "author" && searchedAuthorIds.size > 0) {
      authorships = authorships.filter((authorship) => searchedAuthorIds.has(compactOpenAlexId(authorship.author?.id)));
    }
    if (searchMode === "institution" && searchedInstitutionIds.size > 0) {
      authorships = authorships.filter((authorship) => (authorship.institutions || []).some((institution) => searchedInstitutionIds.has(compactOpenAlexId(institution.id))));
    }
    const reason =
      searchMode === "author"
        ? `Matched by OpenAlex author search for "${query}".`
        : searchMode === "institution"
          ? `Matched by OpenAlex institution search${institutionNames ? ` for ${institutionNames}` : ` for "${query}"`}.`
          : `Matched by OpenAlex works/topic search for "${query}".`;
    const matchSource: MatchSource = searchMode === "institution" ? "institution-search" : searchMode === "author" ? "author-search" : "topic-relevance";
    authorships.forEach((authorship, index) => {
      const matchedInstitution =
        searchMode === "institution"
          ? (authorship.institutions || []).find((institution) => searchedInstitutionIds.has(compactOpenAlexId(institution.id)))
          : undefined;
      upsertAuthor(authors, work, authorship, index + 1, matchSource, reason, searchMode, matchedInstitution);
    });
  }
  searchedAuthors.forEach((author, index) => {
    const id = compactOpenAlexId(author.id);
    const name = author.display_name;
    if (!id || !name) return;
    const exactMatch = exactAuthorNameMatch(name, query);
    const matchSource: MatchSource = exactMatch ? "exact-name" : "author-search";
    const matchReason = exactMatch ? `Exact OpenAlex author-name match for "${query}".` : `Matched by OpenAlex author search for "${query}".`;
    const relevanceBoost = (exactMatch ? 350000 : 250000) - index * 1000;
    const existing = authors.get(id);
    if (existing) {
      existing.relevance += relevanceBoost;
      existing.queryRelevance += relevanceBoost;
      setMatch(existing, matchSource, matchReason, "author");
      return;
    }
    const institution = author.last_known_institutions?.[0] || author.affiliations?.[0]?.institution;
    authors.set(id, {
      id,
      name,
      institution,
      countries: new Set(institution?.country_code ? [institution.country_code] : []),
      works: [],
      coauthors: new Map<string, number>(),
      relevance: relevanceBoost,
      queryRelevance: relevanceBoost,
      matchSource,
      matchReason,
      searchMode: "author",
    });
  });
  const ranked = Array.from(authors.values())
    .sort((a, b) => b.relevance - a.relevance || b.works.length - a.works.length)
    .slice(0, MAX_AUTHORS_TO_HYDRATE);
  const searchedAuthorDetails = new Map<string, OpenAlexAuthor>(searchedAuthors.map((author) => [compactOpenAlexId(author.id), author]));
  const fetchedAuthorDetails = await fetchAuthors(ranked.map((author) => author.id));
  const authorDetails = new Map<string, OpenAlexAuthor>();
  for (const [id, author] of Array.from(searchedAuthorDetails.entries())) {
    if (id) authorDetails.set(id, author);
  }
  for (const [id, author] of Array.from(fetchedAuthorDetails.entries())) {
    authorDetails.set(id, author);
  }
  const rawResearchers = ranked.map((author) => toResearcherRecord(author, authorDetails.get(author.id), citationStartYear, citationEndYear));
  const researchers = searchMode === "author" ? mergeAuthorSearchResults(rawResearchers, query) : rawResearchers;
  return {
    query,
    meta: {
      openAlexCount: worksResponse.meta?.count || 0,
      worksSampled: worksResponse.results?.length || 0,
      researchers: researchers.length,
      dbResponseTimeMs: worksResponse.meta?.db_response_time_ms,
      apiKeyConfigured: Boolean(process.env.OPENALEX_API_KEY?.trim()),
      searchMode,
      sourceLabel: sourceLabel(searchMode),
      citationStartYear,
      citationEndYear,
      authorsSampled: searchedAuthors.length,
      institutionsSampled: searchedInstitutions.length,
      mergedResearchers: rawResearchers.length - researchers.length,
    },
    researchers,
  };
}

export async function handleOpenAlexResearchersRequest(req: { url?: string }, res: JsonResponse) {
  try {
    const url = new URL(req.url || "/api/openalex/researchers", "http://localhost");
    const payload = await resolveOpenAlexResearchers({
      query: url.searchParams.get("query") || undefined,
      minYear: Number(url.searchParams.get("minYear")),
      maxYear: Number(url.searchParams.get("maxYear")),
      citationStartYear: Number(url.searchParams.get("citationStartYear")),
      citationEndYear: Number(url.searchParams.get("citationEndYear")),
      mode: normalizeRequestedSearchMode(url.searchParams.get("mode")),
    });
    jsonResponse(res, 200, payload);
  } catch (error) {
    jsonResponse(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

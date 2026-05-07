import type { ResearcherRecord, ResearchPaper } from "@/lib/data";

const H_INDEX_CAP = 200;
const CITATION_CAP = 200000;
const I10_CAP = 1500;
const CITATIONS_PER_WORK_CAP = 1000;
const WORKS_CAP = 1000;
const CURRENT_YEAR = new Date().getFullYear();
const PAPER_HALF_LIFE_YEARS = 8;
const PROFILE_HALF_LIFE_YEARS = 18;

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function logScale(value: number, cap: number) {
  return clamp((Math.log1p(Math.max(0, value)) / Math.log1p(cap)) * 100);
}

function ageWeight(year: number | undefined, halfLifeYears: number, floor: number) {
  if (!year || year > CURRENT_YEAR) return 1;
  const age = Math.max(0, CURRENT_YEAR - year);
  return Math.max(floor, 0.5 ** (age / halfLifeYears));
}

function authorCredit(paper: ResearchPaper) {
  const record = paper as ResearchPaper & { authorPosition?: number; authorOrder?: number; authorRank?: number };
  const position = Number(record.authorPosition ?? record.authorOrder ?? record.authorRank);
  if (!Number.isFinite(position) || position < 1) return 1;
  return Math.max(0.35, 0.92 ** (position - 1));
}

export function effectivePaperCitations(paper: ResearchPaper) {
  return paper.citations * authorCredit(paper) * ageWeight(paper.year, PAPER_HALF_LIFE_YEARS, 0.08);
}

export function effectiveCitations(researcher: ResearcherRecord) {
  const rawTotal = Math.max(0, researcher.totalCitations);
  const papers = researcher.papers ?? [];
  const paperRawTotal = papers.reduce((sum, paper) => sum + Math.max(0, paper.citations), 0);
  const paperAdjustedTotal = papers.reduce((sum, paper) => sum + effectivePaperCitations(paper), 0);
  const profileAdjustedTotal = rawTotal * ageWeight(researcher.careerStartYear, PROFILE_HALF_LIFE_YEARS, 0.28);
  if (rawTotal === 0) return paperAdjustedTotal;
  const paperCoverage = clamp(paperRawTotal / rawTotal, 0, 1);
  return paperAdjustedTotal * paperCoverage + profileAdjustedTotal * (1 - paperCoverage);
}

export function hIndexScore(researcher: ResearcherRecord) {
  return logScale(researcher.hIndex, H_INDEX_CAP);
}

export function citationScore(researcher: ResearcherRecord) {
  return logScale(effectiveCitations(researcher), CITATION_CAP);
}

export function qualityBreakdown(researcher: ResearcherRecord) {
  const h = hIndexScore(researcher);
  const citations = citationScore(researcher);
  const i10 = logScale(researcher.i10Index, I10_CAP);
  const citationDensity = logScale(effectiveCitations(researcher) / Math.max(1, researcher.totalWorks), CITATIONS_PER_WORK_CAP);
  const productivity = logScale(researcher.totalWorks, WORKS_CAP);
  const recency = clamp(researcher.recencyScore || 0);
  return [
    { key: "h", label: "H-index", value: h, weight: 25, contribution: 0.25 * h, description: "OpenAlex h-index, log-normalized." },
    { key: "citations", label: "Citations", value: citations, weight: 12, contribution: 0.12 * citations, description: "Age-adjusted citation signal, kept low to avoid double-counting." },
    { key: "i10", label: "i10-index", value: i10, weight: 18, contribution: 0.18 * i10, description: "OpenAlex i10-index, log-normalized." },
    { key: "density", label: "Citation density", value: citationDensity, weight: 18, contribution: 0.18 * citationDensity, description: "Effective citations per work." },
    { key: "recency", label: "Recency", value: recency, weight: 17, contribution: 0.17 * recency, description: "Recent matched publication activity." },
    { key: "productivity", label: "Productivity", value: productivity, weight: 10, contribution: 0.1 * productivity, description: "OpenAlex works count, log-normalized." },
  ];
}

export function qualityScore(researcher: ResearcherRecord) {
  return Math.round(qualityBreakdown(researcher).reduce((sum, item) => sum + item.contribution, 0));
}

export function rankingScore(researcher: ResearcherRecord, weights: { hIndex: number; quality: number; citations: number }) {
  const dimensions = [
    { value: hIndexScore(researcher), weight: weights.hIndex },
    { value: qualityScore(researcher), weight: weights.quality },
    { value: citationScore(researcher), weight: weights.citations },
  ].filter((dimension) => dimension.weight > 0);
  const totalWeight = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  if (totalWeight <= 0) return 0;
  const arithmetic = dimensions.reduce((sum, dimension) => sum + dimension.value * dimension.weight, 0) / totalWeight;
  const geometric = Math.exp(dimensions.reduce((sum, dimension) => sum + Math.log(dimension.value + 1) * dimension.weight, 0) / totalWeight) - 1;
  return 0.72 * geometric + 0.28 * arithmetic;
}

# ResearchAI Team Preview Notes

## Email Draft

Subject: ResearchAI test build update and local run instructions

Hi team,

I am sharing a test build of ResearchAI for review. This version now uses live OpenAlex data instead of the previous prepared database, and we made several changes today to make search results more understandable and less misleading.

Main updates:

- Added explicit search modes: Auto, Name, Query, and Institution.
- Name search now merges obvious duplicate OpenAlex author profiles, so split records for the same person are combined into one researcher profile.
- Institution search now separates the matched institution from the author's current or last-known institution. For example, someone can be matched through Hebrew University of Jerusalem while their current OpenAlex profile lists another institution.
- The results table now shows Q, H-index, and R, with sortable columns.
- Q now means normalized query relevance. R means citations received by matched papers during the selected citation year range.
- The citation year range is debounced, so dragging the range does not continuously trigger OpenAlex requests.
- UI readability and layout were improved, including light mode contrast and screen-size scaling in Settings.

Please treat this as a local preview build rather than a production release. OpenAlex data can still contain duplicate profiles, historical affiliations, and incomplete paper coverage, so the interface now tries to expose why each result matched.

How to run it locally is included below. After running it, try a few searches such as:

- Name: `Khaled B. Letaief`
- Institution: `Hebrew University of Jerusalem`
- Query: `post-quantum cryptography`

Best,

[Your Name]

## What Changed Today

### 1. Search mode selector

The search bar now lets users choose:

- `Auto`: app guesses the search intent.
- `Name`: searches OpenAlex authors.
- `Query`: searches OpenAlex works/topics.
- `Institution`: searches OpenAlex institutions and returns researchers connected to matched works.

This avoids one input box silently mixing person, topic, and institution searches.

### 2. Name search profile merging

OpenAlex may return multiple author profiles for the same person, especially with initials, name order variations, spelling variants, or fragmented profiles.

For `Name` mode, ResearchAI now merges obvious variants into one result. Works, citations, i10-index, papers, topics, and collaborators are aggregated. H-index is not added together because H-index is not mathematically additive; the merged profile uses the strongest observed H-index.

### 3. Matched institution vs current institution

Institution search now keeps two separate concepts:

- `Matched institution`: the institution that caused the result to match the search.
- `Current institution`: the author profile's current or last-known institution from OpenAlex.

This matters because researchers can move institutions. A person should still appear when they have a paper affiliation connected to the searched institution, even if their current OpenAlex profile lists another institution.

### 4. Ranking and explainability

The app now exposes:

- Q_norm: normalized query relevance
- R_raw: citations received during the selected citation year range
- R_norm: log-normalized recent citation impact
- Final score: `wQ * Q_norm + wR * R_norm`
- H-index
- Lifetime citations
- Result match source, such as exact name, author search, topic relevance, or institution search

The goal is to make it easier to understand why someone appears in a result list.

## External Ranking Backend Proxy

The Express server can proxy requests to the separate FastAPI ranking backend:

```text
GET  /api/ranking/health
POST /api/ranking/rank
```

Configure the upstream service with:

```text
RANKING_API_URL=https://researcher-ranking-szk6rqcdwa-uc.a.run.app
RANKING_API_AUTH_TOKEN=
```

The browser should call the Express routes above. It should not call the Cloud Run URL directly. Backend-only secrets for the FastAPI service, such as MySQL credentials or Pinecone keys, should stay in that service's own cloud environment and should not be copied into this app.

### 5. Citation year range

The year selector now means citation year range, not publication year range.

Example: `2020-2026` counts citations received between 2020 and 2026, including citations to older papers. A paper published in 2000 can still contribute to R if it was cited during the selected citation window.

The default ranking favors query relevance:

```text
wQ = 0.7
wR = 0.3
Final Score = wQ * Q_norm + wR * R_norm
```

The sliders also allow query-only ranking (`wQ = 1, wR = 0`) and citation-impact-only ranking (`wQ = 0, wR = 1`).

## Local Run Instructions

### Requirements

Install these first:

- Node.js 20 or newer. Node.js 22 or 24 is also fine.
- pnpm 10.x.

If pnpm is not installed:

```bash
npm install -g pnpm
```

### Step 1: Unzip the project

Unzip the shared file, then open a terminal in the project folder:

```bash
cd research-ai
```

On Windows PowerShell, the path may look like:

```powershell
cd C:\Users\YOUR_NAME\Downloads\research-ai
```

### Step 2: Create the environment file

Copy the example environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Open `.env` and optionally set:

```env
OPENALEX_API_KEY=
PORT=3000
```

`OPENALEX_API_KEY` is optional for testing, but recommended because it improves OpenAlex API reliability and rate limits. AI chat keys are entered by each user inside the app Settings screen, so do not put personal OpenAI/Gemini/Claude keys in `.env` unless intentionally configuring a shared server fallback.

### Step 3: Install dependencies

```bash
pnpm install
```

If PowerShell blocks `pnpm.ps1`, use:

```powershell
pnpm.cmd install
```

### Step 4: Run the development server

```bash
pnpm run dev
```

Then open the URL shown in the terminal. It is usually:

```text
http://localhost:5173
```

If PowerShell blocks the command:

```powershell
pnpm.cmd run dev
```

### Step 5: Run a production-style local build

To test the bundled server:

```bash
pnpm run build
pnpm run start
```

Then open:

```text
http://localhost:3000
```

If `PORT` is changed in `.env`, use that port instead.

## Suggested Package Contents

When creating a zip for teammates, include:

- `client/`
- `server/`
- `shared/`
- `scripts/`
- `patches/`
- `.env.example`
- `package.json`
- `pnpm-lock.yaml`
- `tsconfig.json`
- `tsconfig.node.json`
- `vite.config.ts`
- `components.json`
- `render.yaml`
- `Dockerfile`
- `DEPLOYMENT.md`
- `TEAM_HANDOFF.md`

Do not include:

- `node_modules/`
- `.pnpm-store/`
- `dist/`
- `.manus-logs/`
- local `.env`

Those folders are either very large, generated, or local/private.

## Windows Zip Command

From PowerShell, this creates a clean zip on the Desktop:

```powershell
$src = "C:\Users\kongb\Desktop\research-ai"
$zip = "C:\Users\kongb\Desktop\research-ai-team-preview.zip"
$temp = Join-Path $env:TEMP "research-ai-team-preview"

Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $temp | Out-Null

$exclude = @("node_modules", ".pnpm-store", "dist", ".manus-logs", "backups", ".env")
Get-ChildItem -LiteralPath $src -Force |
  Where-Object { $exclude -notcontains $_.Name } |
  Copy-Item -Destination $temp -Recurse -Force

Compress-Archive -Path (Join-Path $temp "*") -DestinationPath $zip -Force
Write-Host "Created $zip"
```

## Current Limitations

- OpenAlex data can still contain duplicate or fragmented author profiles.
- Institution matches can reflect historical paper affiliations, not only current employment.
- Q is normalized query relevance, not an official OpenAlex field.
- R is computed from OpenAlex `counts_by_year` on the matched works and depends on the selected citation year range.
- AI chat requires each tester to provide their own API key in Settings.
- This is still a preview build and not yet a hosted production deployment.

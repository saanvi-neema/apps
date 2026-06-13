# IdeaMorph — Architecture & Developer Guide

## What It Does

A user types a problem (e.g. "How do we reduce food waste in schools?").
The app generates 4 diverse seed ideas using an LLM, embeds them as 384-dimensional
vectors, and displays them as a radial graph. The user can Like, Dislike, Edit,
or Add their own ideas. Clicking "Evolve" makes the AI breed hybrid offspring
from the best ideas. Each generation is tracked with three scientific metrics:
novelty, diversity, and usefulness.

---

## System Diagram

```
Browser (frontend)
│
│  index.html      — page shell, font/script imports
│  style.css       — parchment warm theme, all component styles
│  app.js          — state machine, API calls, popup/tooltip logic
│  tree.js         — D3.js radial graph: positions, animations, node states
│  dashboard.js    — right-panel: line chart, generation cards, stats
│
│         HTTP (JSON)
│  ┌──────────────────────────────┐
│  │  FastAPI (Python backend)    │
│  │                              │
│  │  main.py        — routes     │
│  │  models.py      — schemas    │
│  │  session_store.py — memory   │
│  │  embeddings.py  — vectors    │
│  │  llm.py         — prompts    │
│  │  evolution.py   — scoring    │
│  └──────────┬───────────────────┘
│             │
│     ┌───────┴────────┐
│     │   Groq API     │  (Llama 3.3-70b — idea generation & scoring)
│     └───────┬────────┘
│             │
│     ┌───────┴────────────────────┐
│     │  sentence-transformers     │  (all-MiniLM-L6-v2 — local, no API key)
│     │  384-dim embeddings        │
│     └────────────────────────────┘
```

---

## File-by-File Reference

### Backend

#### `session_store.py`
In-memory store. No database — everything lives in a Python dict keyed by UUID.

```
Session
  session_id: str
  problem: str
  current_generation: int
  ideas: dict[id → IdeaNode]
  generation_index: dict[gen → list[id]]
  mutation_strength: float   (0.1–1.0)
  created_at / last_active: datetime

IdeaNode
  id: UUID str
  text: str
  generation: int
  source: "ai" | "human" | "hybrid"
  parent_ids: list[str]      (empty for gen-0)
  embedding: list[float]     (384 floats, normalized unit vector)
  scores: IdeaScores | None  (None until /api/score is called)
  principle_from_a/b: str    (for hybrids: the extracted principle from each parent)
  semantic_angle: float|None (PCA-projected angle — computed but currently unused in UI)
  liked: bool
  disliked: bool

IdeaScores
  novelty, diversity, usefulness, combined: float  (0–1)
  feasibility, impact, specificity: int            (1–10 raw LLM scores)
  usefulness_reasoning: str
```

Sessions auto-expire after 2 hours of inactivity via an asyncio background task.
The TTL is `SESSION_TTL_HOURS = 2` in session_store.py.

**Gotcha:** all state is in RAM. Restarting the server loses all sessions.
On Render free tier the server sleeps after inactivity, wiping everything.

---

#### `embeddings.py`
Uses `sentence-transformers` with `all-MiniLM-L6-v2` (22M params, runs on CPU, ~80MB).
Embeddings are L2-normalized so cosine similarity = dot product.

Key functions:
- `embed_text(str) → np.ndarray`  — single idea
- `embed_batch(list[str]) → list[np.ndarray]`  — startup seeds
- `cosine_similarity(a, b) → float`  — dot product of normalized vectors
- `novelty_score(target, prior_embs) → float`  — 1 − max(similarity to any prior idea)
- `diversity_score(embeddings) → float`  — avg pairwise distance within a generation
- `semantic_spread(all_embs) → float`  — same as diversity but across the whole session

**Novelty formula (Lehman & Stanley 2011 novelty search):**
```
novelty = 1 - max(cosine_similarity(idea, prior) for prior in all_prior_ideas)
```
Gen-0 ideas return 1.0 (no prior ideas to compare against).

**Diversity formula (standard evolutionary computation):**
```
diversity = mean(1 - cosine_similarity(a, b) for all pairs a,b in generation)
```
This is a property of the whole generation — every idea in a generation gets the
same diversity score.

**Gotcha:** `compute_semantic_angles()` runs PCA (SVD) on the embeddings and returns
2D projected angles. This is stored in IdeaNode.semantic_angle and returned to the
frontend, but the frontend currently does not use it for positioning. It's wired up
in case a future session wants semantic layout.

---

#### `llm.py`
All Groq API calls. Uses `llama-3.3-70b-versatile`, temperature 0.85, max 1024 tokens.
Retries 3× with exponential backoff.

Functions:
- `generate_seeds(problem) → list[str]`  — 4 diverse seed ideas, one per domain
- `generate_hybrid(parent_a, parent_b, problem, history, mutation_strength) → dict`
  Returns `{idea, principle_from_a, principle_from_b}`
- `generate_fresh_injection(problem, history) → str`
  One brand-new idea injected per generation to prevent convergence
- `score_usefulness(idea, problem) → dict`
  Returns `{feasibility, impact, specificity, reasoning}` each 1–10

**Mutation strength effect on prompts:**
- 0.0–0.35 → "Stay close to both parents. Refinement, not radical departure."
- 0.35–0.65 → "Balance fidelity to parents with creative recombination."
- 0.65–1.0 → "Be bold. Use parents as springboards into radically different territory."

**Gotcha:** All LLM responses are parsed as JSON. If the model wraps in markdown
code fences (```json ... ```), `_parse_json()` strips them first. If the model
returns malformed JSON, the whole API call throws and the user gets a 500.

---

#### `evolution.py`

`select_parent_pairs(ideas, mutation_strength) → list[tuple[str,str]]`

Pairing rules (in priority order):
1. Preferred parents: liked ideas + human/hybrid origin ideas that are not disliked
2. Fallback: any non-disliked idea (if preferred pool has fewer than 2)
3. Score all pairs: `sim` if mutation_strength ≤ 0.5 else `1 - sim` (seek distance)
4. Greedy assignment: each idea used in at most one pair, up to 3 pairs total

**Gotcha:** If the user hasn't liked anything and has no human ideas, ALL ideas
fall into the fallback pool and the AI picks the most similar (or most distant)
pairs automatically. This is intentional — the app works with zero human input.

`compute_scores(idea, session) → IdeaScores`

Pulls prior-generation embeddings, calls `novelty_score`, `diversity_score`,
and `score_usefulness` (LLM call). Combined score = 0.4×novelty + 0.3×diversity + 0.3×usefulness.

---

#### `main.py`
FastAPI app. All routes. Also serves `../frontend/` as static files so the
whole app is one deployed service.

Routes:
```
POST /api/start          — generate seeds, create session
POST /api/score          — score one idea (called per-idea from frontend for progressive updates)
POST /api/like           — toggle liked (clears disliked)
POST /api/dislike        — toggle disliked (clears liked)
POST /api/edit-idea      — update text, re-embed, invalidate scores, mark source="human"
POST /api/add-human-idea — add new idea to current generation
POST /api/evolve         — breed next generation from preferred parents + fresh injection
GET  /api/similarities/{session_id}  — all pairwise cosine similarities (for placing human ideas)
GET  /api/metrics/{session_id}       — per-generation avg scores for dashboard
GET  /health             — readiness check (used by Render)
```

**Scoring is called per-idea from the frontend** (not batch) so the UI can update
each node as its score arrives — progressive enhancement.

**Evolve always injects one fresh AI idea** (`generate_fresh_injection`) regardless
of how many hybrids were bred. This prevents the idea pool from converging to a
narrow cluster over many generations.

---

#### `models.py`
Pydantic request/response schemas. Every API response goes through these.
`IdeaNodeOut` is the core shape the frontend receives for every idea.

---

### Frontend

#### `app.js` — State Machine & Controller

States: `IDLE → STARTING → RUNNING → SCORING → EVOLVING`

- `IDLE`: intro screen visible
- `STARTING`: waiting for /api/start
- `RUNNING`: ideas visible, evolve button may be enabled
- `EVOLVING`: waiting for /api/evolve (button disabled)

`pendingScores` counter tracks how many /api/score calls are in flight.
Evolve button only enables when `pendingScores === 0 && state === 'RUNNING'
&& currentGenerationIdeas.length >= 2`.

**Human idea placement:**
When a human types an idea and hits Add, the app:
1. Calls `/api/add-human-idea` to get the idea + its embedding stored
2. Immediately calls `/api/similarities` to get pairwise similarities
3. Finds the highest-similarity existing node in the same generation
4. Calls `Tree.addIdeaNear(idea, nearId)` to place the green node visually
   adjacent to its most semantically similar neighbor

**Node popup (click any node):**
- Like / Dislike: calls backend, toggles gold ring or opacity on node
- Edit: inline textarea → calls /api/edit-idea → re-scores automatically
- Add Child: focuses bottom input bar, tags the parent; next idea submitted
  includes `parent_ids: [clickedId]`

---

#### `tree.js` — D3.js Radial Graph

Positions are computed once per idea and **never change** (ideas don't move after
being placed). This is critical: if positions were recomputed for all ideas each
time a new one is added, existing SVG nodes would be at stale positions while
edges would draw to the new positions — causing visual disconnects.

**Position assignment (`_assignPositions`):**
- Gen 0: ring at 20% of max radius (or center if only 1 idea)
- Gen 1: ring at 42%
- Gen 2: ring at 62%
- Gen 3: ring at 80%
- Gen 4+: ring at 92–95%
- Within each ring: ideas equally spaced by angle
- New ideas get the "next" angle slot without moving existing ideas

**`addIdeaNear(idea, nearId)`** — used for human-added ideas only.
Places the idea at the same radius as `nearId` but offset by ~28° (π/6.5 radians).
This makes the human idea visually adjacent to its most similar AI neighbor.

**Lines are only drawn for hybrid nodes** (`source === 'hybrid'`), connecting
each hybrid to its two parents with a quadratic bezier curve.

**Node visual states:**
- Normal: filled circle, color by source (blue=AI, green=human, purple=hybrid)
- Liked: gold ring inserted behind the node, glow filter
- Disliked: whole node group opacity 0.22
- After scoring: node radius grows proportional to novelty; stroke color shifts
  from tan (#C8BDAA) toward gold (#C49A0A) with usefulness

**Gotcha:** `updateNodeScore` and `updateIdeaState` use `.select('.main-circle')`
and `.select('.liked-ring')` class selectors, not index-based filters, because
the liked ring is dynamically inserted at index 0 and would break index-based
selection.

---

#### `dashboard.js` — Metrics Panel

Three-line chart (novelty / diversity / usefulness per generation) using D3
catmull-rom curves. Updates after every individual score call.

Generation cards show per-generation averages with score bar gauges.
Best idea card shows the highest combined-score idea found so far.

**Gotcha:** Diversity is the same value for all ideas in a generation (it's a
generation-wide property). So avg_diversity for gen N is always a single number
regardless of how many ideas are scored.

---

## Data Flow: Full Round Trip

```
1. User types problem → POST /api/start
   Backend: generate_seeds() → 4 ideas via Groq
            embed_batch() → 4 × 384-dim vectors
            create_session() → store in SESSIONS dict
   Frontend receives: session_id + 4 IdeaNodeOut (no scores yet)
   Tree: addGeneration() — 4 blue nodes placed on gen-0 ring

2. Frontend fires 4 parallel /api/score calls
   Each: compute novelty (vs empty prior), diversity (gen-0 pairwise), usefulness (Groq)
   As each returns: Tree.updateNodeScore() — node grows, stroke shifts gold

3. User likes some ideas → POST /api/like
   Backend: toggles idea.liked, returns updated IdeaNodeOut
   Frontend: Tree.updateIdeaState() — gold ring appears on liked node

4. User clicks Evolve → POST /api/evolve
   Backend: select_parent_pairs() — prefers liked/human, up to 3 pairs
            For each pair: generate_hybrid() → {idea, principle_from_a, principle_from_b}
            + generate_fresh_injection() → 1 brand-new AI idea
            All new ideas embedded and stored
   Frontend receives: N+1 new IdeaNodeOut (hybrids + fresh injection)
   Tree: addGeneration() — purple+blue nodes on next ring, bezier edges to parents

5. Frontend fires N+1 parallel /api/score calls for new generation
   Novelty now compared against ALL prior-generation embeddings (not just gen-0)
   Higher novelty expected if hybrids explored new semantic territory

6. Repeat from step 3 for subsequent generations
```

---

## Key Algorithms Explained

### Why Nearest-Neighbor Novelty (not centroid distance)?
Centroid distance can be fooled: an idea could be far from the average but still
very similar to one specific prior idea. Nearest-neighbor finds the closest existing
idea and measures distance from that. It can't be gamed.

### Why Inject a Fresh Idea Each Generation?
Without injection, the idea pool can converge — hybrids of hybrids of hybrids
eventually cluster in a small semantic region. The fresh injection provides
"genetic diversity" from outside the current lineage.

### Why Is Diversity a Generation Property?
Diversity measures how spread-out the ideas within one generation are from each
other. It's not meaningful per-idea (you can't ask "how diverse is one idea").
So every idea in generation N gets the generation's diversity score.

### How Mutation Strength Works
Low strength → prefer similar parent pairs → child is a refinement
High strength → prefer distant parent pairs → child is a creative leap
The LLM prompt also changes wording to match the intent.

---

## Running Locally

```bash
cd backend
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt

# Create .env with:
# GROQ_API_KEY=your_key_here

python -m uvicorn main:app --reload
# Open http://localhost:8000
```

The first startup downloads `all-MiniLM-L6-v2` (~80MB) and caches it.
Subsequent starts are fast.

---

## Deploying to Render

`render.yaml` at repo root configures everything. Set `GROQ_API_KEY` as an
environment variable in the Render dashboard (not in the file — it's secret).

Build command pre-installs CPU-only PyTorch (~200MB) before requirements to
avoid pulling the full 2GB CUDA build, which would time out on Render free tier.

Cold start on Render free tier takes ~60–90 seconds (model loading).
The `/health` endpoint returns `{"model_loaded": true}` when ready.

---

## Gotchas Summary

| Gotcha | Where | Notes |
|---|---|---|
| State is in RAM only | session_store.py | Server restart = lost sessions |
| Render sleeps on free tier | render.yaml | Cold start ~90s; sleeping wipes RAM |
| First startup downloads model | embeddings.py | ~80MB, one-time per environment |
| LLM JSON parsing can fail | llm.py `_parse_json` | Bad model output → 500 error |
| Node positions are immutable | tree.js | Never reposition already-placed nodes |
| Diversity is gen-wide | embeddings.py | Same value for all ideas in a generation |
| Evolve blocked until all scored | app.js | pendingScores must reach 0 first |
| Gen 5+ all share 0.95 radius | tree.js `GEN_RADII` | May crowd at outer ring |
| semantic_angle computed, unused | main.py / embeddings.py | Wired up but UI ignores it |
| GROQ_API_KEY on server | llm.py | Users never need their own key |

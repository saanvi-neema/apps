# IdeaMorph

An AI-human idea evolution lab. Enter a problem, watch AI generate diverse seed ideas, then Like/Dislike/Edit them and hit **Evolve** to breed hybrid offspring. Each generation is scored on novelty, diversity, and usefulness — tracked live in a radial graph.

Built to demonstrate how creativity emerges from recombination across semantic distance, operationalizing ideas from complexity and innovation research.

---

## Demo

1. Type a problem: *"How can we reduce plastic waste at schools?"*
2. AI generates 4 diverse seed ideas (technology / social / economic / policy angles)
3. Click any node to **Like**, **Dislike**, **Edit**, or **Add Child**
4. Click **Evolve** — AI breeds hybrids from your liked/edited ideas
5. Each hybrid shows which principle it inherited from each parent
6. Repeat for multiple generations and watch the ideas grow more novel

---

## Stack

| Layer | Tool |
|---|---|
| Backend | Python + FastAPI |
| LLM | Groq API — Llama 3.3-70b (free tier, key lives on server) |
| Embeddings | `sentence-transformers` — `all-MiniLM-L6-v2` (local, no API key needed) |
| Graph | D3.js v7 — radial tree layout |
| Frontend | Vanilla HTML + CSS + JS (served by FastAPI) |
| Deploy | Render.com |

No database. Sessions are in-memory and expire after 2 hours of inactivity.

---

## Running Locally

**Prerequisites:** Python 3.10+, a free [Groq API key](https://console.groq.com)

```bash
cd ideamorph/backend

# Install CPU-only PyTorch first (avoids downloading the 2GB CUDA build)
pip install torch --index-url https://download.pytorch.org/whl/cpu

# Install the rest
pip install -r requirements.txt

# Create a .env file with your key
echo "GROQ_API_KEY=your_key_here" > .env

# Start the server
python -m uvicorn main:app --reload
```

Open **http://localhost:8000**

The first startup downloads `all-MiniLM-L6-v2` (~80 MB) and caches it locally. Every startup after that is fast.

---

## Project Structure

```
ideamorph/
├── backend/
│   ├── main.py           # FastAPI routes + startup, serves frontend as static files
│   ├── models.py         # Pydantic request/response schemas
│   ├── embeddings.py     # sentence-transformers, cosine similarity, novelty/diversity math
│   ├── llm.py            # Groq client, all prompt templates
│   ├── evolution.py      # Parent pair selection, score aggregation
│   ├── session_store.py  # In-memory session state (no database)
│   └── requirements.txt
├── frontend/
│   ├── index.html        # Page shell, CDN imports
│   ├── style.css         # Warm parchment theme, all component styles
│   ├── app.js            # State machine, API calls, popup/tooltip logic
│   ├── tree.js           # D3 radial tree: layout, animations, node states
│   └── dashboard.js      # Right panel: line chart, generation cards, stats
├── render.yaml           # Render.com deploy config
├── .gitignore            # Excludes .env, __pycache__, venv
├── README.md
└── ARCHITECTURE.md       # Deep technical reference: algorithms, data flow, gotchas
```

---

## API Endpoints

| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/start` | Generate seed ideas, create session |
| `POST` | `/api/score` | Score one idea (novelty + diversity + usefulness) |
| `POST` | `/api/evolve` | Breed next generation from preferred parents |
| `POST` | `/api/like` | Toggle liked on an idea |
| `POST` | `/api/dislike` | Toggle disliked on an idea |
| `POST` | `/api/edit-idea` | Rewrite an idea's text, re-embed it |
| `POST` | `/api/add-human-idea` | Add a new human-authored idea |
| `GET` | `/api/similarities/{id}` | Pairwise cosine similarities (used for node placement) |
| `GET` | `/api/metrics/{id}` | Per-generation scores for dashboard |
| `GET` | `/health` | Readiness check |

---

## How Scoring Works

**Novelty** — nearest-neighbor cosine distance from the idea to all prior-generation ideas. An idea that explores territory no previous idea has touched scores near 1.0.

**Diversity** — average pairwise cosine distance among all ideas in the same generation. Every idea in a generation shares the same diversity score (it's a generation-level property).

**Usefulness** — Groq evaluates feasibility, impact, and specificity each on a 1–10 scale. Averaged and normalized to 0–1.

**Combined** = 0.4 × novelty + 0.3 × diversity + 0.3 × usefulness

---

## How Evolution Works

When you click **Evolve**:
1. The backend identifies preferred parents: liked ideas + human/edited ideas (disliked excluded)
2. Pairs are selected greedily — each idea used in at most one pair, up to 3 pairs
3. Low mutation strength → pairs similar ideas (refinement). High → pairs distant ideas (exploration)
4. For each pair, the LLM extracts a core principle from each parent and fuses them
5. One completely fresh AI idea is always injected to prevent the pool from converging

The principles extracted from each parent are shown when you hover over a hybrid node.

---

## Deploying to Render

1. Push this repo to GitHub
2. Create a new **Web Service** on [Render](https://render.com)
3. Connect the `saanvi-neema/apps` repo
4. Set **Root Directory** to `ideamorph/backend`
5. Set **Build Command** to:
   ```
   pip install torch --index-url https://download.pytorch.org/whl/cpu && pip install -r requirements.txt
   ```
6. Set **Start Command** to:
   ```
   uvicorn main:app --host 0.0.0.0 --port $PORT
   ```
7. Add environment variable: `GROQ_API_KEY` = your key
8. Deploy

Cold start takes ~60–90 seconds (model loading). The `/health` endpoint returns `{"model_loaded": true}` when ready.

> The CPU-only PyTorch install is required — the default CUDA build is ~2 GB and will time out on Render's free tier.

---

## Node Colors

| Color | Meaning |
|---|---|
| Blue | AI-generated idea |
| Green | Human-authored or edited idea |
| Purple | Hybrid (AI-bred from two parents) |
| Gold ring | Liked — preferred parent for next evolution |
| Faded (22% opacity) | Disliked — excluded from evolution |

---

## For Developers

See **ARCHITECTURE.md** for a full technical reference including:
- Complete data flow end-to-end
- Explanation of the novelty and diversity formulas
- All gotchas (RAM-only state, Render cold start, immutable node positions, etc.)
- How the frontend state machine works

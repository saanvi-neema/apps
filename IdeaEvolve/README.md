# IdeaMorph

An AI-human idea evolution lab with a 3D phylogenetic tree visualization. Enter a problem, watch AI generate diverse seed ideas, then Like/Dislike/Edit/Add your own ideas and hit **Evolve** to breed hybrid offspring across generations.

Each generation is scored on novelty, diversity, and usefulness. The 3D tree grows upward like a real phylogenetic tree — with DNA double helices connecting parents to children, hereditary color blending, and ancestry glow tracing lineage back to generation 0.

---

## The Biology Metaphor

IdeaMorph is built around a rigorous biological analogy:

| Biology | IdeaMorph |
|---|---|
| Genome | Embedding vector (384 numbers from `all-MiniLM-L6-v2`) |
| Phenotype | The idea text you read |
| Alleles | `principle_from_a` / `principle_from_b` — core mechanism inherited from each parent |
| Sexual reproduction | Hybrid crossbreeding via LLM |
| Mutation rate | Mutation strength slider (Refine → Explore) |
| Natural selection | Like / Dislike |
| Genetic drift | Fresh AI injection every generation |
| Genetic distance | Cosine distance between embeddings |
| Phylogenetic tree | The 3D generation tree growing upward |

---

## 3D Visualization

Ideas are rendered as glowing spheres in a navigable 3D space:

- **Y axis** — generation depth. Gen 0 seeds at the bottom, each new generation rises upward like a tree growing
- **X/Z plane** — semantic space. Ideas spread outward based on their embedding similarity. Semantically close ideas cluster together; distant ideas spread apart
- **Camera** — drag to orbit, scroll to zoom, right-click to pan

### Node Encoding

| Visual property | Meaning |
|---|---|
| Sphere size | Novelty score — bigger = more novel (further from all prior ideas) |
| Emissive glow intensity | Usefulness score — brighter = more useful |
| Gold torus ring | Liked — marked as preferred parent for next evolution |
| 22% opacity | Disliked — excluded from evolution |

### Hereditary Color System

Colors reflect genetic lineage — you can trace ancestry just by looking:

| Color | Meaning |
|---|---|
| Blue | Pure AI-generated seed idea |
| Green | Human-authored idea |
| Teal | Hybrid of AI + Human (blue + green blend) |
| Blue-purple | Hybrid of AI + AI (blue blend + 25% purple tint) |
| Deep purple | Hybrid of hybrid + hybrid (most evolved lineage) |
| Green-purple | Hybrid of Human + Hybrid |

Every hybrid's color is computed by blending its two parents' colors 50/50, then adding a 25% purple tint to mark it as a hybrid generation. The deeper into the lineage you go, the more the colors shift and mix.

### DNA Double Helix Connections

Hybrid nodes are connected to their parents by a **DNA double helix**:
- Two intertwined tube strands, each colored in one parent's hereditary color
- Base-pair rungs connecting the two strands at regular intervals
- The helix strand colors match the parent and child colors — you can see the genetic material flowing down the lineage

### Gene-Donor Orbs

Each hybrid sphere has two small orbiting orbs — one in each parent's exact color — representing the two alleles inherited from each parent.

### Ancestry Glow

Click any node to highlight its full lineage back to generation 0. Ancestor nodes flash white-gold. Click empty space to reset the glow.

---

## How Evolution Works

When you click **Evolve**:

1. Backend identifies preferred parents: **liked ideas + human/edited ideas** (disliked excluded)
2. Pairs are selected greedily — each idea used in at most one pair, up to 3 pairs
3. **Low mutation strength** → pairs similar ideas (refinement). **High** → pairs distant ideas (exploration)
4. For each pair, the LLM extracts the core principle from each parent and fuses them into a hybrid
5. One completely **fresh AI idea** is always injected to prevent the pool from converging (genetic drift)
6. The mutation strength slider can be adjusted between generations — it takes effect on the next evolve

---

## How Scoring Works

**Novelty** — nearest-neighbor cosine distance from the idea to all prior-generation ideas. An idea that explores territory no previous idea has touched scores near 1.0. Gen 0 ideas always score 1.0 (no prior ideas to compare against).

**Diversity** — average pairwise cosine distance among all ideas in the same generation. Every idea in a generation shares the same diversity score.

**Usefulness** — Groq evaluates feasibility, impact, and specificity each on a 1–10 scale. Averaged and normalized to 0–1.

**Combined** = 0.4 × novelty + 0.3 × diversity + 0.3 × usefulness

The **Best Idea** panel shows the highest-scoring idea from the most recent generation (not all-time, to avoid gen 0 always winning due to its automatic novelty bonus).

---

## Sample Prompts

These prompts produce the most interesting 3D trees because they span multiple domains — seeds land far apart in semantic space, and hybrids bridge genuinely different territories:

**Biology & Technology**
> "How can biological principles inspire the design of self-healing cities?"

> "How can the human immune system inspire new approaches to cybersecurity?"

**Social & Environment**
> "How can we reduce plastic waste at schools?"

> "How can cities design public spaces that reduce loneliness?"

**Cross-domain**
> "How can evolutionary algorithms improve the way organizations make decisions?"

> "How can the way forests communicate through fungal networks inspire new internet architectures?"

**Tips for a good demo:**
- Add a human idea before evolving gen 0 — it introduces a green node and creates teal hybrids
- Use high mutation strength (0.8+) after gen 2 to get wilder cross-domain ideas
- Click hybrid nodes to trace ancestry — the helix chains across generations are most visible at gen 3+
- Rotate the camera to see the tree from below looking up — the generational layers become clear

---

## Stack

| Layer | Tool |
|---|---|
| Backend | Python + FastAPI |
| LLM | Groq API — Llama 3.3-70b (free tier) |
| Embeddings | `sentence-transformers` — `all-MiniLM-L6-v2` (local, no API key needed) |
| 3D Visualization | Three.js r128 — spheres, TubeGeometry helices, OrbitControls |
| Dashboard | D3.js v7 — line chart, generation cards |
| Frontend | Vanilla HTML + CSS + JS (served by FastAPI) |
| Deploy | Render.com |

No database. Sessions are in-memory and expire after 2 hours of inactivity.

---

## Running Locally

**Prerequisites:** Python 3.10+, a free [Groq API key](https://console.groq.com)

```bash
cd ideaEvolve/backend

# Install CPU-only PyTorch first (avoids the 2GB CUDA build)
pip install torch --index-url https://download.pytorch.org/whl/cpu

# Install the rest
pip install -r requirements.txt

# Create a .env file with your key
echo "GROQ_API_KEY=your_key_here" > .env

# Start the server
python -m uvicorn main:app --reload
```

Open **http://localhost:8000**

First startup downloads `all-MiniLM-L6-v2` (~80 MB) and caches it. Every startup after is fast.

> **Note:** Groq's free tier has a 100k token/day limit. If you hit it, the app shows a rate limit error with the wait time. It typically resets within minutes.

---

## Project Structure

```
ideaEvolve/
├── backend/
│   ├── main.py           # FastAPI routes, serves frontend
│   ├── models.py         # Pydantic schemas
│   ├── embeddings.py     # sentence-transformers, cosine similarity, PCA angles
│   ├── llm.py            # Groq client, prompt templates, rate limit handling
│   ├── evolution.py      # Parent pair selection, score aggregation
│   └── session_store.py  # In-memory session state
├── frontend/
│   ├── index.html        # Page shell
│   ├── style.css         # Parchment theme
│   ├── tree.js           # Three.js 3D tree: spheres, helices, ancestry glow
│   ├── dashboard.js      # D3 line chart, generation cards, stats panel
│   └── app.js            # State machine, API calls, popup/tooltip logic
├── updated-on-repo/      # Files changed locally, ready to push to GitHub
├── render.yaml           # Render.com deploy config
└── ARCHITECTURE.md       # Deep technical reference
```

---

## API Endpoints

| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/start` | Generate seed ideas, create session |
| `POST` | `/api/score` | Score one idea (novelty + diversity + usefulness) |
| `POST` | `/api/evolve` | Breed next generation (accepts optional `mutation_strength`) |
| `POST` | `/api/like` | Toggle liked on an idea |
| `POST` | `/api/dislike` | Toggle disliked on an idea |
| `POST` | `/api/edit-idea` | Rewrite an idea's text, re-embed it |
| `POST` | `/api/add-human-idea` | Add a human-authored idea to the current generation |
| `GET` | `/api/similarities/{id}` | Pairwise cosine similarities (used for node placement) |
| `GET` | `/api/metrics/{id}` | Per-generation scores for dashboard |
| `GET` | `/health` | Readiness check |

---

## Deploying to Render

1. Push this repo to GitHub
2. Create a new **Web Service** on [Render](https://render.com)
3. Set **Root Directory** to `ideaEvolve/backend`
4. Set **Build Command** to:
   ```
   pip install torch --index-url https://download.pytorch.org/whl/cpu && pip install -r requirements.txt
   ```
5. Set **Start Command** to:
   ```
   uvicorn main:app --host 0.0.0.0 --port $PORT
   ```
6. Add environment variable: `GROQ_API_KEY` = your key

Cold start takes ~60–90 seconds (model loading). The `/health` endpoint returns `{"model_loaded": true}` when ready.

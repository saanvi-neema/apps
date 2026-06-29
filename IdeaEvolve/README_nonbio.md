# IdeaMorph

An AI-human idea evolution lab with a 3D tree visualization. Enter a problem, watch AI generate diverse seed ideas, then Like/Dislike/Edit/Add your own ideas and hit **Evolve** to breed hybrid offspring across generations.

Each generation is scored on novelty, diversity, and usefulness. The 3D tree grows upward over time — with connections linking parent ideas to their children, color blending showing lineage, and ancestry tracing letting you click any idea to see where it came from.

---

## How It Works

You start with a problem. The AI generates 4 seed ideas from completely different angles — technology, social, economic, policy. You explore them, mark the ones you like, add your own perspective, and hit Evolve. The AI breeds hybrid ideas by extracting the core principle from each parent and fusing them. Repeat across generations and watch the ideas grow more novel and surprising.

The human is in the loop the whole time — your likes, dislikes, and added ideas steer the direction of evolution.

---

## 3D Visualization

Ideas are rendered as glowing spheres in a navigable 3D space:

- **Y axis** — generation. Gen 0 seeds at the bottom, each new generation rises upward
- **X/Z plane** — semantic space. Ideas spread outward based on meaning similarity. Conceptually close ideas cluster together; distant ideas spread apart
- **Camera** — drag to orbit, scroll to zoom, right-click to pan

### Node Encoding

| Visual property | Meaning |
|---|---|
| Sphere size | Novelty score — bigger = more novel |
| Glow intensity | Usefulness score — brighter = more useful |
| Gold torus ring | Liked — preferred parent for next generation |
| 22% opacity | Disliked — excluded from next generation |

### Lineage Color System

Colors reflect where an idea came from — you can trace ancestry just by looking:

| Color | Meaning |
|---|---|
| Blue | AI-generated seed idea |
| Green | Human-authored idea |
| Teal | Child of AI + Human |
| Blue-purple | Child of AI + AI |
| Deep purple | Child of hybrid + hybrid (most evolved) |
| Green-purple | Child of Human + Hybrid |

Every child idea's color is a 50/50 blend of its two parents' colors, with a slight purple tint added to mark it as a new generation. The deeper into the lineage, the more the colors shift and mix — you can see idea ancestry at a glance.

### Connections

Child ideas are visually connected to their parents by curved lines in the parent colors, showing which ideas contributed to each new one.

### Small Orbs

Each hybrid sphere has two small orbs — one in each parent's exact color — showing the two ideas that contributed to it.

### Ancestry Trace

Click any idea node to highlight its full lineage back to generation 0. Ancestor nodes flash bright. Click empty space to reset.

---

## How Evolution Works

When you click **Evolve**:

1. Backend identifies preferred parents: **liked ideas + human/edited ideas** (disliked excluded)
2. Pairs are selected — each idea used in at most one pair, up to 3 pairs
3. **Low mutation strength** → pairs similar ideas (refinement). **High** → pairs distant ideas (exploration)
4. For each pair, the LLM extracts the core principle from each parent and fuses them into a new idea
5. One completely **fresh AI idea** is always injected to prevent the pool from stagnating
6. The mutation strength slider can be adjusted between generations — it takes effect on the next evolve

---

## How Scoring Works

**Novelty** — how different is this idea from everything that came before it? Measured as semantic distance from all prior-generation ideas. An idea that explores completely new territory scores near 1.0.

**Diversity** — how spread out are all the ideas in this generation? Every idea in a generation shares the same diversity score — it's a property of the whole generation, not any single idea.

**Usefulness** — the AI evaluates feasibility, impact, and specificity each on a 1–10 scale. Averaged and normalized to 0–1.

**Combined** = 0.4 × novelty + 0.3 × diversity + 0.3 × usefulness

The **Best Idea** panel shows the highest-scoring idea from the most recent generation.

---

## Sample Prompts

These prompts produce the most interesting results because they span multiple domains — seed ideas land far apart in semantic space, and hybrids bridge genuinely unexpected territory:

**Technology & Society**
> "How can the human immune system inspire new approaches to cybersecurity?"

> "How can biological principles inspire the design of self-healing cities?"

**Environment**
> "How can we reduce plastic waste at schools?"

> "How can cities design public spaces that reduce loneliness?"

**Organizations & Systems**
> "How can evolutionary algorithms improve the way organizations make decisions?"

> "How can the way forests communicate through fungal networks inspire new internet architectures?"

**Tips for a good session:**
- Add your own idea before the first evolve — it steers the direction from the start
- Use high mutation strength (0.8+) after gen 2 to push ideas into unexpected territory
- Click any hybrid node to trace where it came from — the connections across generations become most visible at gen 3+
- Rotate the camera to see the idea tree from below looking up — the generational layers become clear

---

## Stack

| Layer | Tool |
|---|---|
| Backend | Python + FastAPI |
| LLM | Groq API — Llama 3.3-70b (free tier) |
| Embeddings | `sentence-transformers` — `all-MiniLM-L6-v2` (local, no API key needed) |
| 3D Visualization | Three.js r128 — spheres, tube connections, OrbitControls |
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

> **Note:** Groq's free tier has a 100k token/day limit. If you hit it, the app shows an error message with the wait time. It typically resets within minutes.

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
│   ├── tree.js           # Three.js 3D tree: spheres, connections, ancestry glow
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

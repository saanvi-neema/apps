import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

load_dotenv()

from embeddings import embed_batch, embed_text, semantic_spread, compute_semantic_angles
from evolution import compute_scores, select_parent_pairs
from llm import generate_hybrid, generate_seeds, generate_fresh_injection
from models import (
    AddHumanIdeaRequest,
    EditIdeaRequest,
    EvolveRequest,
    EvolveResponse,
    IdeaNodeOut,
    IdeaScoresOut,
    LikeRequest,
    MetricsResponse,
    ScoreRequest,
    ScoreResponse,
    StartRequest,
    StartResponse,
)
from session_store import (
    IdeaNode,
    Session,
    add_idea,
    cleanup_sessions,
    create_session,
    get_generation_ideas,
    get_session,
    make_idea_id,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from embeddings import get_model
    get_model()
    asyncio.create_task(cleanup_sessions())
    yield


app = FastAPI(title="Idea Evolution Lab", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def recompute_angles_for_generation(session: Session, generation: int) -> None:
    ideas = get_generation_ideas(session, generation)
    if len(ideas) < 2:
        if ideas:
            ideas[0].semantic_angle = 0.0
        return
    embeddings = [np.array(i.embedding) for i in ideas]
    angles = compute_semantic_angles(embeddings)
    for idea, angle in zip(ideas, angles):
        idea.semantic_angle = angle


def idea_to_out(idea: IdeaNode) -> IdeaNodeOut:
    scores_out = None
    if idea.scores:
        s = idea.scores
        scores_out = IdeaScoresOut(
            novelty=s.novelty,
            diversity=s.diversity,
            usefulness=s.usefulness,
            combined=s.combined,
            usefulness_reasoning=s.usefulness_reasoning,
            feasibility=s.feasibility,
            impact=s.impact,
            specificity=s.specificity,
        )
    return IdeaNodeOut(
        id=idea.id,
        text=idea.text,
        generation=idea.generation,
        source=idea.source,
        parent_ids=idea.parent_ids,
        scores=scores_out,
        principle_from_a=idea.principle_from_a,
        principle_from_b=idea.principle_from_b,
        semantic_angle=idea.semantic_angle,
        liked=idea.liked,
        disliked=idea.disliked,
    )


@app.get("/health")
def health():
    from embeddings import _model
    return {"status": "ok", "model_loaded": _model is not None}


@app.post("/api/start", response_model=StartResponse)
def start(req: StartRequest):
    if not req.problem.strip():
        raise HTTPException(400, "Problem cannot be empty")
    mutation_strength = max(0.1, min(1.0, req.mutation_strength))

    ideas_text = generate_seeds(req.problem)
    embeddings = embed_batch(ideas_text)

    session = create_session(req.problem, mutation_strength)

    nodes: list[IdeaNode] = []
    for text, emb in zip(ideas_text, embeddings):
        node = IdeaNode(
            id=make_idea_id(),
            text=text,
            generation=0,
            source="ai",
            parent_ids=[],
            embedding=emb.tolist(),
        )
        add_idea(session, node)
        nodes.append(node)

    recompute_angles_for_generation(session, 0)
    return StartResponse(session_id=session.session_id, ideas=[idea_to_out(n) for n in nodes])


@app.post("/api/score", response_model=ScoreResponse)
def score(req: ScoreRequest):
    session = get_session(req.session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    idea = session.ideas.get(req.idea_id)
    if not idea:
        raise HTTPException(404, "Idea not found")

    scores = compute_scores(idea, session)
    idea.scores = scores

    return ScoreResponse(idea_id=idea.id, scores=IdeaScoresOut(
        novelty=scores.novelty,
        diversity=scores.diversity,
        usefulness=scores.usefulness,
        combined=scores.combined,
        usefulness_reasoning=scores.usefulness_reasoning,
        feasibility=scores.feasibility,
        impact=scores.impact,
        specificity=scores.specificity,
    ))


@app.post("/api/like", response_model=IdeaNodeOut)
def like_idea(req: LikeRequest):
    session = get_session(req.session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    idea = session.ideas.get(req.idea_id)
    if not idea:
        raise HTTPException(404, "Idea not found")
    idea.liked = not idea.liked   # toggle
    idea.disliked = False
    return idea_to_out(idea)


@app.post("/api/dislike", response_model=IdeaNodeOut)
def dislike_idea(req: LikeRequest):
    session = get_session(req.session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    idea = session.ideas.get(req.idea_id)
    if not idea:
        raise HTTPException(404, "Idea not found")
    idea.disliked = not idea.disliked  # toggle
    idea.liked = False
    return idea_to_out(idea)


@app.post("/api/edit-idea", response_model=IdeaNodeOut)
def edit_idea(req: EditIdeaRequest):
    session = get_session(req.session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    idea = session.ideas.get(req.idea_id)
    if not idea:
        raise HTTPException(404, "Idea not found")
    idea.text = req.new_text.strip()
    idea.source = "human"
    idea.embedding = embed_text(idea.text).tolist()
    idea.scores = None  # invalidate scores since text changed
    recompute_angles_for_generation(session, idea.generation)
    return idea_to_out(idea)


@app.post("/api/add-human-idea", response_model=IdeaNodeOut)
def add_human_idea(req: AddHumanIdeaRequest):
    session = get_session(req.session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if not req.text.strip():
        raise HTTPException(400, "Idea text cannot be empty")

    emb = embed_text(req.text)
    node = IdeaNode(
        id=make_idea_id(),
        text=req.text.strip(),
        generation=session.current_generation,
        source="human",
        parent_ids=req.parent_ids,
        embedding=emb.tolist(),
    )
    add_idea(session, node)
    recompute_angles_for_generation(session, session.current_generation)
    return idea_to_out(node)


@app.post("/api/evolve", response_model=EvolveResponse)
def evolve(req: EvolveRequest):
    session = get_session(req.session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    if req.mutation_strength is not None:
        session.mutation_strength = max(0.1, min(1.0, req.mutation_strength))

    current_gen = session.current_generation
    current_ideas = get_generation_ideas(session, current_gen)
    if len(current_ideas) < 2:
        raise HTTPException(400, "Need at least 2 ideas to evolve")

    if req.parent_pairs:
        pairs = [(a, b) for a, b in req.parent_pairs]
    else:
        pairs = select_parent_pairs(current_ideas, session.mutation_strength)

    if not pairs:
        raise HTTPException(400, "No valid pairs found to evolve")

    all_history = [i.text for i in session.ideas.values()]
    next_gen = current_gen + 1
    new_nodes: list[IdeaNode] = []

    for a_id, b_id in pairs:
        idea_a = session.ideas.get(a_id)
        idea_b = session.ideas.get(b_id)
        if not idea_a or not idea_b:
            continue

        result = generate_hybrid(
            parent_a=idea_a.text,
            parent_b=idea_b.text,
            problem=session.problem,
            history=all_history,
            mutation_strength=session.mutation_strength,
        )

        emb = embed_text(result["idea"])
        node = IdeaNode(
            id=make_idea_id(),
            text=result["idea"],
            generation=next_gen,
            source="hybrid",
            parent_ids=[a_id, b_id],
            embedding=emb.tolist(),
            principle_from_a=result.get("principle_from_a", ""),
            principle_from_b=result.get("principle_from_b", ""),
        )
        add_idea(session, node)
        new_nodes.append(node)
        all_history.append(node.text)

    # Fresh AI injection each generation
    fresh_text = generate_fresh_injection(session.problem, all_history)
    fresh_emb = embed_text(fresh_text)
    fresh_node = IdeaNode(
        id=make_idea_id(),
        text=fresh_text,
        generation=next_gen,
        source="ai",
        parent_ids=[],
        embedding=fresh_emb.tolist(),
    )
    add_idea(session, fresh_node)
    new_nodes.append(fresh_node)

    recompute_angles_for_generation(session, next_gen)
    session.current_generation = next_gen
    return EvolveResponse(generation=next_gen, ideas=[idea_to_out(n) for n in new_nodes])


@app.get("/api/similarities/{session_id}")
def similarities(session_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    ideas = list(session.ideas.values())
    pairs = []
    for i in range(len(ideas)):
        for j in range(i + 1, len(ideas)):
            a, b = ideas[i], ideas[j]
            sim = float(np.dot(np.array(a.embedding), np.array(b.embedding)))
            pairs.append({"source": a.id, "target": b.id, "similarity": round(sim, 4)})
    return {"pairs": pairs}


@app.get("/api/metrics/{session_id}", response_model=MetricsResponse)
def metrics(session_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    generations = sorted(session.generation_index.keys())
    avg_novelty, avg_diversity, avg_usefulness = [], [], []

    best_idea: IdeaNode | None = None
    best_combined = -1.0
    latest_scored_gen: int | None = None

    for gen in generations:
        ideas = get_generation_ideas(session, gen)
        scored = [i for i in ideas if i.scores]
        if scored:
            avg_novelty.append(round(sum(i.scores.novelty for i in scored) / len(scored), 3))
            avg_diversity.append(round(scored[0].scores.diversity, 3))
            avg_usefulness.append(round(sum(i.scores.usefulness for i in scored) / len(scored), 3))
            latest_scored_gen = gen
        else:
            avg_novelty.append(0.0)
            avg_diversity.append(0.0)
            avg_usefulness.append(0.0)

    # Best idea: highest combined score within the latest generation that has scores.
    # Avoids gen 0 always winning due to its automatic novelty = 1.0 bonus.
    if latest_scored_gen is not None:
        latest_scored = [i for i in get_generation_ideas(session, latest_scored_gen) if i.scores]
        for i in latest_scored:
            if i.scores.combined > best_combined:
                best_combined = i.scores.combined
                best_idea = i

    all_embs = [np.array(i.embedding) for i in session.ideas.values()]
    spread = round(semantic_spread(all_embs), 3) if len(all_embs) >= 2 else 0.0

    all_scored = [i for i in session.ideas.values() if i.scores]
    peak_nov = round(max((i.scores.novelty for i in all_scored), default=0.0), 3)

    return MetricsResponse(
        generations=generations,
        avg_novelty=avg_novelty,
        avg_diversity=avg_diversity,
        avg_usefulness=avg_usefulness,
        best_idea=idea_to_out(best_idea) if best_idea else None,
        total_ideas=len(session.ideas),
        semantic_spread=spread,
        peak_novelty=peak_nov,
    )


# Serve frontend
frontend_path = Path(__file__).parent.parent / "frontend"
if frontend_path.exists():
    app.mount("/static", StaticFiles(directory=str(frontend_path)), name="static")

    @app.get("/")
    def index():
        return FileResponse(str(frontend_path / "index.html"))

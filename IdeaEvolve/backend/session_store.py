import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Literal
from uuid import uuid4

import numpy as np


@dataclass
class IdeaScores:
    novelty: float
    diversity: float
    usefulness: float
    combined: float
    usefulness_reasoning: str = ""
    feasibility: int = 0
    impact: int = 0
    specificity: int = 0


@dataclass
class IdeaNode:
    id: str
    text: str
    generation: int
    source: Literal["ai", "human", "hybrid"]
    parent_ids: list[str]
    embedding: list[float]
    scores: IdeaScores | None = None
    principle_from_a: str = ""
    principle_from_b: str = ""
    semantic_angle: float | None = None
    liked: bool = False
    disliked: bool = False


@dataclass
class Session:
    session_id: str
    problem: str
    current_generation: int
    ideas: dict[str, IdeaNode]
    generation_index: dict[int, list[str]]
    mutation_strength: float
    created_at: datetime
    last_active: datetime


SESSIONS: dict[str, Session] = {}
SESSION_TTL_HOURS = 2


def create_session(problem: str, mutation_strength: float) -> Session:
    session_id = str(uuid4())
    now = datetime.utcnow()
    session = Session(
        session_id=session_id,
        problem=problem,
        current_generation=0,
        ideas={},
        generation_index={},
        mutation_strength=mutation_strength,
        created_at=now,
        last_active=now,
    )
    SESSIONS[session_id] = session
    return session


def get_session(session_id: str) -> Session | None:
    session = SESSIONS.get(session_id)
    if session:
        session.last_active = datetime.utcnow()
    return session


def add_idea(session: Session, idea: IdeaNode) -> None:
    session.ideas[idea.id] = idea
    gen = idea.generation
    if gen not in session.generation_index:
        session.generation_index[gen] = []
    session.generation_index[gen].append(idea.id)


def get_generation_ideas(session: Session, generation: int) -> list[IdeaNode]:
    ids = session.generation_index.get(generation, [])
    return [session.ideas[i] for i in ids]


def get_prior_embeddings(session: Session, before_generation: int) -> list[np.ndarray]:
    """Return embeddings from all generations strictly before the given one."""
    result = []
    for gen in range(before_generation):
        for idea_id in session.generation_index.get(gen, []):
            result.append(np.array(session.ideas[idea_id].embedding))
    return result


def make_idea_id() -> str:
    return str(uuid4())


async def cleanup_sessions():
    """Background task: evict sessions idle for SESSION_TTL_HOURS."""
    while True:
        await asyncio.sleep(600)  # check every 10 minutes
        cutoff = datetime.utcnow() - timedelta(hours=SESSION_TTL_HOURS)
        stale = [sid for sid, s in SESSIONS.items() if s.last_active < cutoff]
        for sid in stale:
            del SESSIONS[sid]

from pydantic import BaseModel


class StartRequest(BaseModel):
    problem: str
    mutation_strength: float = 0.5


class ScoreRequest(BaseModel):
    session_id: str
    idea_id: str


class EvolveRequest(BaseModel):
    session_id: str
    parent_pairs: list[list[str]] | None = None


class AddHumanIdeaRequest(BaseModel):
    session_id: str
    text: str
    parent_ids: list[str] = []

class LikeRequest(BaseModel):
    session_id: str
    idea_id: str

class EditIdeaRequest(BaseModel):
    session_id: str
    idea_id: str
    new_text: str


class IdeaScoresOut(BaseModel):
    novelty: float
    diversity: float
    usefulness: float
    combined: float
    usefulness_reasoning: str
    feasibility: int
    impact: int
    specificity: int


class IdeaNodeOut(BaseModel):
    id: str
    text: str
    generation: int
    source: str
    parent_ids: list[str]
    scores: IdeaScoresOut | None
    principle_from_a: str
    principle_from_b: str
    semantic_angle: float | None
    liked: bool
    disliked: bool


class AddHumanIdeaResponse(BaseModel):
    idea: IdeaNodeOut
    most_similar_id: str | None = None


class StartResponse(BaseModel):
    session_id: str
    ideas: list[IdeaNodeOut]


class ScoreResponse(BaseModel):
    idea_id: str
    scores: IdeaScoresOut


class EvolveResponse(BaseModel):
    generation: int
    ideas: list[IdeaNodeOut]


class MetricsResponse(BaseModel):
    generations: list[int]
    avg_novelty: list[float]
    avg_diversity: list[float]
    avg_usefulness: list[float]
    best_idea: IdeaNodeOut | None
    total_ideas: int
    semantic_spread: float
    peak_novelty: float

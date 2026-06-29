import numpy as np

from embeddings import cosine_similarity, novelty_score, diversity_score
from session_store import IdeaNode, IdeaScores, Session, get_generation_ideas, get_prior_embeddings
from llm import score_usefulness


def select_parent_pairs(ideas: list[IdeaNode], mutation_strength: float) -> list[tuple[str, str]]:
    """
    Pairing rules:
    - Only use liked ideas + human-origin ideas as parents.
    - If none, fall back to all non-disliked ideas.
    - Pair each parent with its most similar partner (greedy, no idea used twice).
    - AI-only ideas never pair with each other unless there are no human/liked ideas.
    """
    # Preferred parents: liked or human-origin, not disliked
    preferred = [i for i in ideas if (i.liked or i.source in ("human", "hybrid")) and not i.disliked]

    # Fallback: any non-disliked idea
    if len(preferred) < 2:
        preferred = [i for i in ideas if not i.disliked]

    if len(preferred) < 2:
        return []

    # Build all pairs ranked by similarity (or distance at high mutation)
    scored: list[tuple[float, str, str]] = []
    for i in range(len(preferred)):
        for j in range(i + 1, len(preferred)):
            a, b = preferred[i], preferred[j]
            sim = cosine_similarity(np.array(a.embedding), np.array(b.embedding))
            score = sim if mutation_strength <= 0.5 else (1 - sim)
            scored.append((score, a.id, b.id))
    scored.sort(reverse=True)

    # Greedy: each idea in at most one pair
    used: set[str] = set()
    pairs: list[tuple[str, str]] = []
    for _, a_id, b_id in scored:
        if a_id not in used and b_id not in used:
            pairs.append((a_id, b_id))
            used.add(a_id)
            used.add(b_id)
        if len(pairs) >= 3:
            break

    return pairs


def compute_scores(idea: IdeaNode, session: Session) -> IdeaScores:
    target_emb = np.array(idea.embedding)
    prior_embs = get_prior_embeddings(session, before_generation=idea.generation)
    nov = novelty_score(target_emb, prior_embs)

    gen_ideas = get_generation_ideas(session, idea.generation)
    gen_embs = [np.array(i.embedding) for i in gen_ideas]
    div = diversity_score(gen_embs)

    usefulness_result = score_usefulness(idea.text, session.problem)
    f = usefulness_result.get("feasibility", 5)
    imp = usefulness_result.get("impact", 5)
    spec = usefulness_result.get("specificity", 5)
    use = (f + imp + spec) / 3 / 10
    reasoning = usefulness_result.get("reasoning", "")

    combined = 0.4 * nov + 0.3 * div + 0.3 * use

    return IdeaScores(
        novelty=round(nov, 3),
        diversity=round(div, 3),
        usefulness=round(use, 3),
        combined=round(combined, 3),
        usefulness_reasoning=reasoning,
        feasibility=f,
        impact=imp,
        specificity=spec,
    )


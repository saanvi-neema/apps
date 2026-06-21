import numpy as np
from sentence_transformers import SentenceTransformer

_model: SentenceTransformer | None = None


def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer("all-mpnet-base-v2")
    return _model


def embed_text(text: str) -> np.ndarray:
    return get_model().encode(text, normalize_embeddings=True)


def embed_batch(texts: list[str]) -> list[np.ndarray]:
    embeddings = get_model().encode(texts, normalize_embeddings=True)
    return [embeddings[i] for i in range(len(texts))]


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    # Embeddings are already normalized, so dot product = cosine similarity
    return float(np.dot(a, b))


def novelty_score(target_emb: np.ndarray, prior_embs: list[np.ndarray]) -> float:
    """
    Nearest-neighbor cosine distance from target to all prior ideas.
    Higher = more novel. Gen-0 ideas return 1.0 (no prior ideas to compare against).
    Equivalent to the novelty metric in Lehman & Stanley (2011) novelty search.
    """
    if not prior_embs:
        return 1.0
    sims = [cosine_similarity(target_emb, p) for p in prior_embs]
    return float(1.0 - max(sims))


def diversity_score(embeddings: list[np.ndarray]) -> float:
    """
    Average pairwise cosine distance among all embeddings in a generation.
    Property of the whole generation — each idea in the gen gets the same score.
    Matches standard intra-population diversity from evolutionary computation.
    """
    n = len(embeddings)
    if n < 2:
        return 0.0
    total = 0.0
    count = 0
    for i in range(n):
        for j in range(i + 1, n):
            total += 1.0 - cosine_similarity(embeddings[i], embeddings[j])
            count += 1
    return float(total / count)


def semantic_spread(all_embeddings: list[np.ndarray]) -> float:
    """Average pairwise distance across ALL ideas in the session."""
    return diversity_score(all_embeddings)


def compute_semantic_angles(embeddings: list[np.ndarray]) -> list[float]:
    """
    Project embeddings to 2D via PCA, return angles (0 to 2π).
    Similar ideas will land at similar angles, placing them near each other on the ring.
    """
    n = len(embeddings)
    if n == 0:
        return []
    if n == 1:
        return [0.0]

    E = np.stack(embeddings)        # (n, 384)
    E = E - E.mean(axis=0)          # center

    # PCA: first 2 principal components
    _, _, Vt = np.linalg.svd(E, full_matrices=False)
    proj = E @ Vt[:2].T             # (n, 2)

    angles = np.arctan2(proj[:, 1], proj[:, 0])   # (-π, π)
    angles = (angles + 2 * np.pi) % (2 * np.pi)   # (0, 2π)
    return angles.tolist()

import json
import os
import time

from groq import Groq

_client: Groq | None = None


def get_client() -> Groq:
    global _client
    if _client is None:
        _client = Groq(api_key=os.environ["GROQ_API_KEY"])
    return _client


def _chat(system: str, user: str, retries: int = 3) -> str:
    for attempt in range(retries):
        try:
            resp = get_client().chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.85,
                max_tokens=1024,
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            err_str = str(e)
            # Surface rate limit errors immediately — no point retrying
            if "rate_limit_exceeded" in err_str or "429" in err_str:
                import re
                wait = re.search(r"try again in ([^.]+)", err_str)
                wait_msg = f" Try again in {wait.group(1)}." if wait else ""
                raise RuntimeError(f"Groq rate limit reached.{wait_msg}") from e
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)
    return ""


def _parse_json(text: str) -> dict | list:
    # Strip markdown code fences if present
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return json.loads(text)


def generate_seeds(problem: str) -> list[str]:
    system = (
        "You are a creative problem-solving assistant with expertise in systems thinking, "
        "lateral thinking, and cross-domain innovation. You generate diverse, concrete, "
        "actionable ideas — not vague suggestions. Respond only with valid JSON."
    )
    user = f"""Problem: {problem}

Generate exactly 4 seed ideas. Make them maximally diverse — each from a completely different angle:
one technology-based, one social/behavioral, one economic/incentive, one policy or design approach.

Each idea should be one punchy sentence: specific and concrete, not vague.

Respond with this exact JSON:
{{"ideas": ["<idea 1>", "<idea 2>", "<idea 3>", "<idea 4>"]}}"""

    result = _parse_json(_chat(system, user))
    return result["ideas"]


def _mutation_instructions(mutation_strength: float) -> tuple[str, str]:
    if mutation_strength < 0.35:
        instruction = "Stay close to both parents. Generate a refinement and combination, not a radical departure."
        adjective = "an incremental improvement that clearly inherits from"
    elif mutation_strength < 0.65:
        instruction = "Balance fidelity to parents with creative recombination. The hybrid should feel related to but distinct from both parents."
        adjective = "distinctly different from but recognizably descended from"
    else:
        instruction = "Be bold. Use the parents as springboards into radically different territory. The hybrid may barely resemble its parents."
        adjective = "a radical departure inspired by but largely independent of"
    return instruction, adjective


def generate_hybrid(
    parent_a: str,
    parent_b: str,
    problem: str,
    history: list[str],
    mutation_strength: float,
) -> dict:
    """Returns dict with keys: idea, principle_from_a, principle_from_b"""
    instruction, adjective = _mutation_instructions(mutation_strength)
    history_text = "\n".join(f"- {h}" for h in history) if history else "(none yet)"

    system = (
        "You are a creative synthesizer specializing in combinatorial innovation. "
        "You take two existing ideas and generate a genuinely novel hybrid that preserves "
        "the best mechanisms from each parent while exploring new territory. "
        "A good hybrid extracts the underlying principle from each parent and fuses those "
        "principles into something new — not just 'combine A and B'. "
        "Respond only with valid JSON."
    )
    user = f"""Problem: {problem}

Parent Idea A: "{parent_a}"
Parent Idea B: "{parent_b}"

Ideas already explored — DO NOT repeat these, generate something meaningfully different:
{history_text}

Mutation strength instruction: {instruction}
The child idea should be {adjective} its parents.

Generate exactly 1 hybrid child idea. It should:
1. Extract the core mechanism/principle from Parent A
2. Extract the core mechanism/principle from Parent B
3. Fuse these principles in a way that neither parent captures alone

Respond with this exact JSON:
{{"idea": "<child idea, 2-3 sentences>", "principle_from_a": "<one short phrase>", "principle_from_b": "<one short phrase>"}}"""

    return _parse_json(_chat(system, user))


def generate_fresh_injection(problem: str, history: list[str]) -> str:
    """
    Generate 1 brand-new AI idea that is NOT derived from any existing idea.
    Provides fresh genetic material each generation to prevent convergence.
    """
    history_text = "\n".join(f"- {h}" for h in history) if history else "(none yet)"
    system = (
        "You are a radical creative thinker who generates completely fresh ideas. "
        "You do NOT build on existing ideas — you approach problems from entirely new angles. "
        "Respond only with valid JSON."
    )
    user = f"""Problem: {problem}

Ideas already explored (do NOT repeat or build on these — explore completely different territory):
{history_text}

Generate exactly 1 fresh, original idea that approaches the problem from an angle NONE of the above ideas touch.
Think: different domain, different mechanism, different scale, different stakeholder.
2-3 sentences, specific and actionable.

Respond with this exact JSON:
{{"idea": "<fresh idea>"}}"""

    result = _parse_json(_chat(system, user))
    return result["idea"]


def score_usefulness(idea: str, problem: str) -> dict:
    """Returns dict with keys: feasibility, impact, specificity, reasoning"""
    system = (
        "You are a rigorous evaluator of creative problem-solving ideas. "
        "You score ideas for their practical usefulness toward a specific problem. "
        "Respond only with valid JSON. No explanation, no preamble."
    )
    user = f"""Problem: {problem}

Idea to evaluate: "{idea}"

Score this idea on the following criteria (each 1–10):
- feasibility: Can this realistically be implemented with current resources?
- impact: If implemented, how significantly would it help solve the problem?
- specificity: Is this a concrete actionable idea (vs. vague platitude)?

Respond with this exact JSON:
{{"feasibility": <int 1-10>, "impact": <int 1-10>, "specificity": <int 1-10>, "reasoning": "<one sentence explaining the scores>"}}"""

    return _parse_json(_chat(system, user))

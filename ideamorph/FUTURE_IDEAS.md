# Future Ideas

Planned improvements and research directions for IdeaMorph.

---

## Visualization

- Use `semantic_angle` (already computed via PCA, already in every API response) to position nodes by meaning — similar ideas cluster together on the ring instead of being evenly spaced
- Force-directed layout as an alternative view: nodes repel/attract based on cosine similarity, so the graph self-organizes into semantic neighborhoods
- Animate edges growing as hybrids are born, with the two parent nodes briefly glowing before the child appears
- Color edges by the mutation strength used to produce that generation

---

## Evolution Mechanics

- Let users manually drag-connect two nodes to force a specific pairing before evolving
- "Crossover point" slider per pair: how much of parent A vs parent B to inherit (currently 50/50 implied by the prompt)
- Multi-parent hybrids: blend 3 ideas instead of 2 for wilder recombination
- Fitness pressure: automatically discard the bottom N% of ideas each generation (true evolutionary selection)
- Island model: run two independent populations in parallel, occasionally migrate the best idea between them

---

## Metrics & Research

- Track semantic trajectory over generations as a 2D PCA path — visualize whether the idea pool is expanding outward or converging inward
- Compare AI-only runs vs human-guided runs on the same problem: does human input measurably improve novelty, usefulness, or both?
- Export the full session as JSON or CSV for offline analysis
- Plot a "family tree" view alongside the radial view: ideas as nodes in a DAG, generations top-to-bottom

---

## Persistence

- Save sessions to a database (SQLite + SQLAlchemy is the smallest lift) so sessions survive server restarts and Render sleep cycles
- Share sessions via URL: generate a read-only shareable link to a finished idea tree
- Export the best idea card as a PNG or PDF

---

## UI / UX

- Mobile layout: the current 75/25 canvas/panel split breaks on small screens
- Undo: revert the last like/dislike/edit action
- Search/filter: type a keyword to highlight nodes whose text contains it
- Keyboard shortcuts: `L` to like, `D` to dislike, `E` to evolve, `Esc` to close popup
- Session timeout warning: notify the user before their 2-hour session expires

---

## Models

- Swap `all-MiniLM-L6-v2` for a larger embedding model (`all-mpnet-base-v2`, 768-dim) for more accurate similarity — costs more RAM but fits on Render's paid tier
- Let the user choose the LLM model (Groq offers several) or temperature from the UI
- Add a "domain expert" persona option: the LLM scores usefulness from the perspective of a teacher, engineer, policymaker, etc.

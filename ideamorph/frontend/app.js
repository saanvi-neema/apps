// ── Idea Evolution Lab — Main Controller ─────────────────────────────────────
// State machine: IDLE → STARTING → RUNNING → SCORING → EVOLVING

const App = (() => {
  // ── State ─────────────────────────────────────────────────────────────────
  let sessionId = null;
  let allIdeas = [];          // IdeaNodeOut[]
  let currentGeneration = 0;
  let pendingScores = 0;      // how many scoring calls are in flight
  let state = 'IDLE';
  let pendingParentId = null; // set when "Add Child" popup action is used
  let currentPopupIdea = null;

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const introScreen   = document.getElementById('intro-screen');
  const appEl         = document.getElementById('app');
  const problemInput  = document.getElementById('problem-input');
  const startBtn      = document.getElementById('start-btn');
  const introError    = document.getElementById('intro-error');
  const mutationSlider     = document.getElementById('mutation-slider');
  const appMutationSlider  = document.getElementById('app-mutation-slider');
  const appMutationVal     = document.getElementById('app-mutation-val');
  const headerProblem      = document.getElementById('header-problem');
  const bottomProblem      = document.getElementById('bottom-problem');
  const humanIdeaInput     = document.getElementById('human-idea-input');
  const addHumanBtn        = document.getElementById('add-human-btn');
  const evolveBtn          = document.getElementById('evolve-btn');
  const resetBtn           = document.getElementById('reset-btn');
  const loadingOverlay     = document.getElementById('loading-overlay');
  const loadingText        = document.getElementById('loading-text');
  const tooltip            = document.getElementById('tooltip');
  const treeSvg            = document.getElementById('tree-svg');

  // Popup DOM refs
  const nodePopup       = document.getElementById('node-popup');
  const popupClose      = document.getElementById('popup-close');
  const popupIdeaText   = document.getElementById('popup-idea-text');
  const popupLikeBtn    = document.getElementById('popup-like-btn');
  const popupDislikeBtn = document.getElementById('popup-dislike-btn');
  const popupEditBtn    = document.getElementById('popup-edit-btn');
  const popupChildBtn   = document.getElementById('popup-child-btn');
  const popupEditArea   = document.getElementById('popup-edit-area');
  const popupEditTA     = document.getElementById('popup-edit-textarea');
  const popupSaveBtn    = document.getElementById('popup-save-btn');

  // ── API ────────────────────────────────────────────────────────────────────
  const BASE = '';  // same origin

  async function api(path, body) {
    const opts = body ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } : { method: 'GET' };
    const res = await fetch(BASE + path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // ── Tooltip ────────────────────────────────────────────────────────────────
  function showTooltip(event, idea) {
    if (!idea || currentPopupIdea) { tooltip.classList.add('hidden'); return; }
    const s = idea.scores;
    const parents = idea.parent_ids.map(pid => {
      const p = allIdeas.find(d => d.id === pid);
      return p ? p.text.slice(0, 60) + '…' : '';
    }).filter(Boolean);

    const principlesHtml = (idea.source === 'hybrid' && idea.principle_from_a)
      ? `<div class="tooltip-principles">
           <div><span class="principle-label">A:</span> ${idea.principle_from_a}</div>
           <div><span class="principle-label">B:</span> ${idea.principle_from_b}</div>
         </div>`
      : '';

    tooltip.innerHTML = `
      <div class="tooltip-gen">GENERATION ${idea.generation}</div>
      <div class="tooltip-badge ${idea.source}">${idea.source}</div>
      <div class="tooltip-text">${idea.text}</div>
      ${principlesHtml}
      ${s ? `
      <div class="tooltip-scores">
        <div class="tooltip-score nov"><span class="label">N </span><span class="val">${s.novelty.toFixed(2)}</span></div>
        <div class="tooltip-score div"><span class="label">D </span><span class="val">${s.diversity.toFixed(2)}</span></div>
        <div class="tooltip-score use"><span class="label">U </span><span class="val">${s.usefulness.toFixed(2)}</span></div>
        <div class="tooltip-score use"><span class="label">★ </span><span class="val" style="color:var(--gold)">${s.combined.toFixed(2)}</span></div>
      </div>
      ${s.usefulness_reasoning ? `<div class="tooltip-reasoning">"${s.usefulness_reasoning}"</div>` : ''}
      ` : '<div class="tooltip-reasoning">Scoring…</div>'}
      ${parents.length ? `<div class="tooltip-parents">↑ ${parents.join('<br>↑ ')}</div>` : ''}
    `;

    tooltip.classList.remove('hidden');
    const x = Math.min(event.clientX + 12, window.innerWidth - 300);
    const y = Math.min(event.clientY + 12, window.innerHeight - 200);
    tooltip.style.left = x + 'px';
    tooltip.style.top  = y + 'px';
  }

  // ── Node Popup ─────────────────────────────────────────────────────────────
  function showNodePopup(event, idea) {
    currentPopupIdea = idea;
    tooltip.classList.add('hidden');

    popupIdeaText.textContent = idea.text;

    // Toggle active state on like/dislike buttons
    popupLikeBtn.classList.toggle('active', !!idea.liked);
    popupDislikeBtn.classList.toggle('active', !!idea.disliked);

    // Reset edit area
    popupEditArea.classList.remove('visible');
    popupEditTA.value = idea.text;

    nodePopup.classList.remove('hidden');

    // Position near the click, keeping popup within viewport
    const pw = 240, ph = 200;
    let x = event.clientX + 14;
    let y = event.clientY - 20;
    if (x + pw > window.innerWidth  - 10) x = event.clientX - pw - 14;
    if (y + ph > window.innerHeight - 10) y = window.innerHeight - ph - 10;
    if (y < 8) y = 8;
    nodePopup.style.left = x + 'px';
    nodePopup.style.top  = y + 'px';
  }

  function hideNodePopup() {
    nodePopup.classList.add('hidden');
    currentPopupIdea = null;
    popupEditArea.classList.remove('visible');
  }

  // ── Like / Dislike ─────────────────────────────────────────────────────────
  async function handleLike() {
    if (!currentPopupIdea || !sessionId) return;
    const idea = currentPopupIdea;
    try {
      const res = await api('/api/like', { session_id: sessionId, idea_id: idea.id });
      // Update the same object reference in allIdeas
      const local = allIdeas.find(d => d.id === idea.id);
      if (local) { local.liked = res.liked; local.disliked = res.disliked; }
      Tree.updateIdeaState(res);
      // Update popup button states
      popupLikeBtn.classList.toggle('active', !!res.liked);
      popupDislikeBtn.classList.toggle('active', !!res.disliked);
      currentPopupIdea = local || res;
    } catch (e) { console.error('Like failed', e); }
  }

  async function handleDislike() {
    if (!currentPopupIdea || !sessionId) return;
    const idea = currentPopupIdea;
    try {
      const res = await api('/api/dislike', { session_id: sessionId, idea_id: idea.id });
      const local = allIdeas.find(d => d.id === idea.id);
      if (local) { local.liked = res.liked; local.disliked = res.disliked; }
      Tree.updateIdeaState(res);
      popupLikeBtn.classList.toggle('active', !!res.liked);
      popupDislikeBtn.classList.toggle('active', !!res.disliked);
      currentPopupIdea = local || res;
    } catch (e) { console.error('Dislike failed', e); }
  }

  // ── Edit ───────────────────────────────────────────────────────────────────
  function handleEditToggle() {
    const isVisible = popupEditArea.classList.contains('visible');
    if (isVisible) {
      popupEditArea.classList.remove('visible');
    } else {
      popupEditTA.value = currentPopupIdea?.text || '';
      popupEditArea.classList.add('visible');
      popupEditTA.focus();
    }
  }

  async function handleSaveEdit() {
    if (!currentPopupIdea || !sessionId) return;
    const newText = popupEditTA.value.trim();
    if (!newText || newText === currentPopupIdea.text) {
      popupEditArea.classList.remove('visible');
      return;
    }
    const idea = currentPopupIdea;
    popupSaveBtn.textContent = 'Saving…';
    popupSaveBtn.disabled = true;
    try {
      const res = await api('/api/edit-idea', {
        session_id: sessionId,
        idea_id: idea.id,
        new_text: newText,
      });
      // Update local copy
      const local = allIdeas.find(d => d.id === idea.id);
      if (local) {
        local.text = res.text;
        local.source = res.source;
        local.scores = null;
        local.liked = res.liked;
        local.disliked = res.disliked;
      }
      Tree.updateIdeaState(res);
      hideNodePopup();
      // Re-score the edited idea
      pendingScores++;
      _updateEvolveBtn();
      try {
        const scored = await api('/api/score', { session_id: sessionId, idea_id: res.id });
        if (local) local.scores = scored.scores;
        Tree.updateNodeScore(local || res);
      } catch (e) {
        console.warn('Re-score after edit failed', e);
      } finally {
        pendingScores--;
        _updateEvolveBtn();
        _refreshMetrics();
      }
    } catch (e) {
      console.error('Edit failed', e);
    } finally {
      popupSaveBtn.textContent = 'Save Changes';
      popupSaveBtn.disabled = false;
    }
  }

  // ── Add Child ──────────────────────────────────────────────────────────────
  function handleAddChild() {
    if (!currentPopupIdea) return;
    const idea = currentPopupIdea;
    pendingParentId = idea.id;
    hideNodePopup();

    // Show parent indicator above human input or update placeholder
    humanIdeaInput.placeholder = `Child of: "${idea.text.slice(0, 40)}…"`;
    humanIdeaInput.focus();

    // Show a small removable tag near the input
    _renderParentTag(idea);
  }

  function _renderParentTag(idea) {
    const existing = document.getElementById('parent-tag');
    if (existing) existing.remove();
    const tag = document.createElement('span');
    tag.id = 'parent-tag';
    tag.className = 'parent-indicator';
    tag.title = 'Click to remove parent link';
    tag.textContent = `↳ ${idea.text.slice(0, 30)}…`;
    tag.addEventListener('click', () => {
      pendingParentId = null;
      humanIdeaInput.placeholder = 'Add your own idea…';
      tag.remove();
    });
    humanIdeaInput.parentElement.insertBefore(tag, humanIdeaInput);
  }

  // ── Loading helpers ────────────────────────────────────────────────────────
  function showLoading(text) {
    loadingText.textContent = text;
    loadingOverlay.classList.remove('hidden');
  }
  function hideLoading() { loadingOverlay.classList.add('hidden'); }

  // ── Score ideas progressively ──────────────────────────────────────────────
  async function scoreIdeas(ideas) {
    pendingScores += ideas.length;
    _updateEvolveBtn();

    const promises = ideas.map(async idea => {
      try {
        const res = await api('/api/score', { session_id: sessionId, idea_id: idea.id });
        const local = allIdeas.find(d => d.id === idea.id);
        if (local) local.scores = res.scores;
        Tree.updateNodeScore(local || idea);
      } catch (e) {
        console.warn('Score failed for', idea.id, e);
      } finally {
        pendingScores--;
        _updateEvolveBtn();
        _refreshMetrics();
      }
    });

    await Promise.all(promises);
  }

  async function _refreshMetrics() {
    if (!sessionId) return;
    try {
      const m = await api(`/api/metrics/${sessionId}`);
      Dashboard.update(m, currentGeneration);
    } catch (e) {
      console.warn('Metrics refresh failed', e);
    }
  }

  // ── Evolve button state ────────────────────────────────────────────────────
  function _updateEvolveBtn() {
    const currentIdeas = allIdeas.filter(d => d.generation === currentGeneration);
    const canEvolve = currentIdeas.length >= 2 && pendingScores === 0 && state === 'RUNNING';
    evolveBtn.disabled = !canEvolve;
    if (pendingScores > 0) {
      evolveBtn.textContent = `Scoring… (${pendingScores} left)`;
    } else {
      evolveBtn.textContent = `Evolve → Gen ${currentGeneration + 1}`;
    }
  }

  // ── Start ──────────────────────────────────────────────────────────────────
  async function start() {
    const problem = problemInput.value.trim();
    if (!problem) { introError.textContent = 'Please enter a problem first.'; return; }
    introError.textContent = '';

    const mutStrength = parseFloat(mutationSlider.value);

    introScreen.classList.add('hidden');
    appEl.classList.remove('hidden');

    headerProblem.textContent = problem;
    bottomProblem.textContent = problem;
    appMutationSlider.value = mutStrength;
    appMutationVal.textContent = mutStrength.toFixed(2);

    Tree.init(treeSvg, showTooltip, showNodePopup);

    showLoading('Generating seed ideas…');
    state = 'STARTING';

    try {
      const res = await api('/api/start', { problem, mutation_strength: mutStrength });
      sessionId = res.session_id;
      allIdeas = res.ideas;
      currentGeneration = 0;

      hideLoading();
      state = 'RUNNING';

      Tree.addGeneration(res.ideas, allIdeas);
      await scoreIdeas(res.ideas);
    } catch (e) {
      hideLoading();
      state = 'IDLE';
      console.error('Failed to start:', e.message);
      // Show visible error so user isn't left with a blank screen
      loadingText.textContent = '⚠ ' + e.message;
      loadingText.style.color = 'var(--danger)';
      loadingOverlay.classList.remove('hidden');
      setTimeout(() => {
        loadingOverlay.classList.add('hidden');
        loadingText.style.color = '';
      }, 6000);
    }
  }

  // ── Add human idea ─────────────────────────────────────────────────────────
  async function addHumanIdea() {
    const text = humanIdeaInput.value.trim();
    if (!text || !sessionId) return;
    humanIdeaInput.value = '';
    humanIdeaInput.placeholder = 'Add your own idea…';

    // Consume pending parent tag
    const parentIds = pendingParentId ? [pendingParentId] : [];
    pendingParentId = null;
    const tag = document.getElementById('parent-tag');
    if (tag) tag.remove();

    try {
      const idea = await api('/api/add-human-idea', {
        session_id: sessionId,
        text,
        parent_ids: parentIds,
      });
      allIdeas.push(idea);

      // Find the most similar existing node in the same generation,
      // so the human idea appears visually next to its closest semantic neighbor.
      let mostSimilarId = null;
      try {
        const sims = await api(`/api/similarities/${sessionId}`);
        if (sims?.pairs) {
          const sameGen = allIdeas
            .filter(d => d.generation === idea.generation && d.id !== idea.id)
            .map(d => d.id);
          let maxSim = -1;
          for (const p of sims.pairs) {
            let otherId = null;
            if (p.source === idea.id) otherId = p.target;
            else if (p.target === idea.id) otherId = p.source;
            if (otherId && sameGen.includes(otherId) && p.similarity > maxSim) {
              maxSim = p.similarity;
              mostSimilarId = otherId;
            }
          }
        }
      } catch (e) {
        console.warn('Similarity fetch failed, using default placement', e);
      }

      if (mostSimilarId) {
        Tree.addIdeaNear(idea, mostSimilarId, allIdeas);
      } else {
        Tree.addGeneration([idea], allIdeas);
      }

      await scoreIdeas([idea]);
    } catch (e) {
      console.error('Add human idea failed', e);
    }
  }

  // ── Evolve ─────────────────────────────────────────────────────────────────
  async function evolve() {
    if (!sessionId || state !== 'RUNNING') return;
    state = 'EVOLVING';
    evolveBtn.classList.add('loading');
    evolveBtn.disabled = true;
    showLoading(`Evolving generation ${currentGeneration + 1}…`);

    try {
      const res = await api('/api/evolve', { session_id: sessionId });
      currentGeneration = res.generation;
      allIdeas.push(...res.ideas);

      hideLoading();
      state = 'RUNNING';
      evolveBtn.classList.remove('loading');

      Tree.addGeneration(res.ideas, allIdeas);
      _updateEvolveBtn();
      await scoreIdeas(res.ideas);
    } catch (e) {
      hideLoading();
      state = 'RUNNING';
      evolveBtn.classList.remove('loading');
      _updateEvolveBtn();
      console.error('Evolve failed', e);
    }
  }

  // ── Reset ──────────────────────────────────────────────────────────────────
  function reset() {
    sessionId = null;
    allIdeas = [];
    currentGeneration = 0;
    pendingScores = 0;
    pendingParentId = null;
    state = 'IDLE';
    hideNodePopup();
    Tree.clear();
    appEl.classList.add('hidden');
    introScreen.classList.remove('hidden');
    problemInput.value = '';
    humanIdeaInput.value = '';
    humanIdeaInput.placeholder = 'Add your own idea…';
    const tag = document.getElementById('parent-tag');
    if (tag) tag.remove();
  }

  // ── Popup event bindings ───────────────────────────────────────────────────
  popupClose.addEventListener('click', hideNodePopup);
  popupLikeBtn.addEventListener('click', handleLike);
  popupDislikeBtn.addEventListener('click', handleDislike);
  popupEditBtn.addEventListener('click', handleEditToggle);
  popupSaveBtn.addEventListener('click', handleSaveEdit);
  popupChildBtn.addEventListener('click', handleAddChild);

  // Close popup when clicking outside it
  document.addEventListener('click', (e) => {
    if (!nodePopup.classList.contains('hidden') && !nodePopup.contains(e.target)) {
      hideNodePopup();
    }
  });

  // ── Mutation slider sync ───────────────────────────────────────────────────
  appMutationSlider.addEventListener('input', () => {
    appMutationVal.textContent = parseFloat(appMutationSlider.value).toFixed(2);
  });

  // ── Event bindings ─────────────────────────────────────────────────────────
  startBtn.addEventListener('click', start);
  problemInput.addEventListener('keydown', e => { if (e.key === 'Enter') start(); });
  addHumanBtn.addEventListener('click', addHumanIdea);
  humanIdeaInput.addEventListener('keydown', e => { if (e.key === 'Enter') addHumanIdea(); });
  evolveBtn.addEventListener('click', evolve);
  resetBtn.addEventListener('click', reset);

  // Enter key in edit textarea → save
  popupEditTA.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSaveEdit();
  });

  // Window resize
  window.addEventListener('resize', () => Tree.resize(treeSvg));
})();

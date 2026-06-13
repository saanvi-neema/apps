// ── Idea Evolution Lab — Radial Tree ─────────────────────────────────────────
// Generation 0 at center, each new generation in an outer ring.
// Lines only connect hybrid nodes to their parents.

const Tree = (() => {
  const COLOR = { ai: '#3B8AE8', human: '#2DB86A', hybrid: '#8B52E0' };

  let svg, g, defs;
  let width = 0, height = 0;
  let nodesData = [];
  const positions = {};   // id → {x, y}  — never mutated once set
  let onHover = null;
  let onClick = null;

  // Fixed radii per generation (fraction of maxRadius).
  // These never change, so existing nodes are never repositioned.
  const GEN_RADII = [0.20, 0.42, 0.62, 0.80, 0.92];

  function init(svgEl, hoverCallback, clickCallback) {
    onHover = hoverCallback;
    onClick = clickCallback || null;
    svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const rect = svgEl.getBoundingClientRect();
    width = rect.width;
    height = rect.height;

    defs = svg.append('defs');
    _addGlowFilter('glow-ai',     '#3B8AE8', 5);
    _addGlowFilter('glow-human',  '#2DB86A', 5);
    _addGlowFilter('glow-hybrid', '#8B52E0', 7);
    _addGlowFilter('glow-liked',  '#C49A0A', 8);

    const rg = defs.append('radialGradient').attr('id', 'bg-grad');
    rg.append('stop').attr('offset', '0%').attr('stop-color', '#EDE8DC');
    rg.append('stop').attr('offset', '100%').attr('stop-color', '#F4EFE4');
    svg.append('rect').attr('width', width).attr('height', height).attr('fill', 'url(#bg-grad)');

    g = svg.append('g').attr('transform', `translate(${width / 2},${height / 2})`);
    g.append('g').attr('class', 'links-layer');
    g.append('g').attr('class', 'nodes-layer');

    svg.call(d3.zoom().scaleExtent([0.3, 3]).on('zoom', e => g.attr('transform', e.transform)));
  }

  function _addGlowFilter(id, color, blur) {
    const f = defs.append('filter').attr('id', id)
      .attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%');
    f.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', blur).attr('result', 'blur');
    const merge = f.append('feMerge');
    merge.append('feMergeNode').attr('in', 'blur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');
  }

  function _maxRadius() {
    return Math.min(width, height) * 0.42;
  }

  function _nodeRadius(idea) {
    return 10 + (idea.scores?.novelty ?? 0.4) * 16;
  }

  function _strokeColor(idea) {
    return d3.interpolate('#C8BDAA', '#C49A0A')(idea.scores?.usefulness ?? 0.5);
  }

  function _genRadius(gen) {
    const maxR = _maxRadius();
    if (gen === 0) return maxR * GEN_RADII[0];
    const frac = gen < GEN_RADII.length ? GEN_RADII[gen] : 0.95;
    return frac * maxR;
  }

  // Assign positions to ideas that don't have one yet.
  // Ideas with existing positions are never moved.
  function _assignPositions(ideas) {
    // Group by generation so we can evenly space within each gen's ring
    const byGen = {};
    ideas.forEach(d => {
      (byGen[d.generation] = byGen[d.generation] || []).push(d);
    });

    Object.entries(byGen).forEach(([gen, list]) => {
      const g = parseInt(gen);
      const r = g === 0 && list.length === 1 ? 0 : _genRadius(g);

      list.forEach((idea, i) => {
        if (positions[idea.id]) return;  // never reposition
        const n = list.length;
        const angle = (n === 1 && r === 0)
          ? 0
          : (i / n) * 2 * Math.PI - Math.PI / 2;
        positions[idea.id] = { x: r * Math.cos(angle), y: r * Math.sin(angle) };
      });
    });
  }

  // Place a single idea near an existing node (by nearId), at the same radius.
  // Used when adding a human idea — positions it next to the most similar AI node.
  function _assignPositionNear(idea, nearId) {
    const near = positions[nearId];
    if (!near) return false;

    const r = Math.sqrt(near.x ** 2 + near.y ** 2);
    const nearAngle = Math.atan2(near.y, near.x);

    // Offset ~28° (π/6.5) so the human node sits visibly adjacent, not on top
    const offset = Math.PI / 6.5;
    const angle = nearAngle + offset;
    positions[idea.id] = { x: r * Math.cos(angle), y: r * Math.sin(angle) };
    return true;
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  function _renderLinks(ideas, delay = 0) {
    const linksLayer = g.select('.links-layer');
    ideas.forEach((idea, i) => {
      if (idea.source !== 'hybrid') return;
      idea.parent_ids.forEach(pid => {
        const from = positions[pid];
        const to   = positions[idea.id];
        if (!from || !to) return;
        const linkId = `link-${pid}-${idea.id}`;
        if (!g.select(`#${linkId}`).empty()) return;

        const path = linksLayer.append('path')
          .attr('id', linkId)
          .attr('d', _curvePath(from, to))
          .attr('stroke', 'rgba(44,40,32,0.2)')
          .attr('stroke-width', 1.5)
          .attr('fill', 'none')
          .attr('opacity', 0);

        const len = path.node().getTotalLength?.() ?? 100;
        path.attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
          .transition().delay((delay + i) * 80).duration(350).ease(d3.easeQuadOut)
          .attr('stroke-dashoffset', 0).attr('opacity', 0.7);
      });
    });
  }

  function _renderNodes(ideas, baseDelay = 300) {
    const nodesLayer = g.select('.nodes-layer');
    ideas.forEach((idea, i) => {
      const pos = positions[idea.id];
      if (!pos) return;
      const r     = _nodeRadius(idea);
      const color = COLOR[idea.source] || COLOR.ai;

      const nodeG = nodesLayer.append('g')
        .attr('class', 'idea-node')
        .attr('data-id', idea.id)
        .attr('transform', `translate(${pos.x},${pos.y}) scale(0)`)
        .style('cursor', 'pointer')
        .on('mouseenter', (event) => { if (onHover) onHover(event, idea); })
        .on('mousemove',  (event) => { if (onHover) onHover(event, idea); })
        .on('mouseleave', ()      => { if (onHover) onHover(null, null); })
        .on('click', (event) => { event.stopPropagation(); if (onClick) onClick(event, idea); });

      nodeG.append('circle').attr('class', 'glow-ring')
        .attr('r', r + 8).attr('fill', color).attr('opacity', 0.08);
      nodeG.append('circle').attr('class', 'main-circle')
        .attr('r', r).attr('fill', color).attr('opacity', 0.88)
        .attr('filter', `url(#glow-${idea.source})`)
        .attr('stroke', _strokeColor(idea)).attr('stroke-width', 1.5);
      nodeG.append('text').attr('class', 'gen-label')
        .attr('y', r + 13).attr('text-anchor', 'middle')
        .attr('font-size', '9px').attr('font-family', "'JetBrains Mono', monospace")
        .attr('fill', 'rgba(44,40,32,0.4)').attr('pointer-events', 'none')
        .text(`G${idea.generation}`);

      nodeG.transition()
        .delay(baseDelay + i * 80).duration(500)
        .ease(d3.easeElasticOut.amplitude(1).period(0.5))
        .attr('transform', `translate(${pos.x},${pos.y}) scale(1)`);
    });

    setTimeout(() => _pulseNodes(ideas.map(d => d.id)), baseDelay + ideas.length * 80 + 200);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  // Add a batch of ideas (e.g. a whole new generation).
  function addGeneration(newIdeas, allIdeas) {
    nodesData = allIdeas;
    _assignPositions(allIdeas);
    _renderLinks(newIdeas);
    _renderNodes(newIdeas);
  }

  // Add a single human idea placed near `nearId` (the most similar existing node).
  // Falls back to normal placement if nearId is missing.
  function addIdeaNear(idea, nearId, allIdeas) {
    nodesData = allIdeas;
    if (!_assignPositionNear(idea, nearId)) {
      _assignPositions(allIdeas);
    }
    _renderNodes([idea], 100);
  }

  function _curvePath(from, to) {
    const mx = (from.x + to.x) / 2 * 0.5;
    const my = (from.y + to.y) / 2 * 0.5;
    return `M${from.x},${from.y} Q${mx},${my} ${to.x},${to.y}`;
  }

  function _pulseNodes(ids) {
    ids.forEach(id => {
      g.select(`[data-id="${id}"]`).select('.glow-ring')
        .transition().duration(300).attr('opacity', 0.25)
        .transition().duration(400).attr('opacity', 0.08);
    });
  }

  function updateNodeScore(idea) {
    const nodeG = g.select(`[data-id="${idea.id}"]`);
    if (nodeG.empty()) return;
    const r = _nodeRadius(idea);
    nodeG.select('.main-circle')
      .transition().duration(400).ease(d3.easeElasticOut.amplitude(0.8).period(0.5))
      .attr('r', r).attr('stroke', _strokeColor(idea));
    nodeG.select('.glow-ring').transition().duration(400).attr('r', r + 8);
    nodeG.select('.gen-label').attr('y', r + 13);
    const likedRing = nodeG.select('.liked-ring');
    if (!likedRing.empty()) likedRing.transition().duration(300).attr('r', r + 14);
  }

  function updateIdeaState(idea) {
    const nodeG = g.select(`[data-id="${idea.id}"]`);
    if (nodeG.empty()) return;
    nodeG.select('.liked-ring').remove();
    if (idea.liked) {
      const r = _nodeRadius(idea);
      nodeG.insert('circle', ':first-child')
        .attr('class', 'liked-ring')
        .attr('r', r + 14).attr('fill', 'none')
        .attr('stroke', '#C49A0A').attr('stroke-width', 2.5)
        .attr('filter', 'url(#glow-liked)')
        .attr('opacity', 0)
        .transition().duration(300).attr('opacity', 0.9);
    }
    nodeG.transition().duration(200)
      .style('opacity', idea.disliked ? 0.22 : 1);
  }

  function clear() {
    if (g) {
      g.select('.links-layer').selectAll('*').remove();
      g.select('.nodes-layer').selectAll('*').remove();
    }
    nodesData = [];
    Object.keys(positions).forEach(k => delete positions[k]);
  }

  function resize(svgEl) {
    const rect = svgEl.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    svg.select('rect').attr('width', width).attr('height', height);
    if (g) g.attr('transform', `translate(${width / 2},${height / 2})`);
  }

  return { init, addGeneration, addIdeaNear, updateNodeScore, updateIdeaState, clear, resize };
})();

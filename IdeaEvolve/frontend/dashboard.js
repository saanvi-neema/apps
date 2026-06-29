// ── Idea Evolution Lab — Metrics Dashboard ────────────────────────────────────
// Renders the metrics panel: line chart, generation cards, best idea, stats.

const Dashboard = (() => {

  function renderChart(metrics) {
    const svgEl = document.getElementById('chart-svg');
    const d3svg = d3.select(svgEl);
    d3svg.selectAll('*').remove();

    const W = svgEl.clientWidth;
    const H = svgEl.clientHeight || 110;
    const margin = { top: 10, right: 10, bottom: 22, left: 28 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const chart = d3svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const gens = metrics.generations;
    if (!gens || gens.length < 1) return;

    const x = d3.scaleLinear().domain([0, Math.max(gens.length - 1, 1)]).range([0, w]);
    const y = d3.scaleLinear().domain([0, 1]).range([h, 0]);

    // Grid lines
    chart.append('g').attr('class', 'grid')
      .selectAll('line').data([0, 0.25, 0.5, 0.75, 1]).enter()
      .append('line')
      .attr('x1', 0).attr('x2', w)
      .attr('y1', d => y(d)).attr('y2', d => y(d))
      .attr('stroke', 'rgba(44,40,32,0.1)').attr('stroke-width', 1);

    // X axis ticks
    chart.append('g').attr('transform', `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(Math.min(gens.length, 6)).tickFormat(d => `G${d}`))
      .call(g => g.select('.domain').remove())
      .call(g => g.selectAll('text').attr('fill', '#666').attr('font-size', 9).attr('font-family', "'JetBrains Mono'"))
      .call(g => g.selectAll('.tick line').remove());

    // Y axis
    chart.append('g')
      .call(d3.axisLeft(y).ticks(3).tickFormat(d => d.toFixed(1)))
      .call(g => g.select('.domain').remove())
      .call(g => g.selectAll('text').attr('fill', '#666').attr('font-size', 9).attr('font-family', "'JetBrains Mono'"))
      .call(g => g.selectAll('.tick line').remove());

    const line = d3.line().x((d, i) => x(i)).y(d => y(d)).curve(d3.curveCatmullRom);

    const series = [
      { data: metrics.avg_novelty,    color: '#3B8AE8', label: 'Novelty' },
      { data: metrics.avg_diversity,  color: '#8B52E0', label: 'Diversity' },
      { data: metrics.avg_usefulness, color: '#2DB86A', label: 'Usefulness' },
    ];

    series.forEach(({ data, color }) => {
      if (!data || !data.length) return;
      const path = chart.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.85)
        .attr('d', line);

      // Animate path draw
      const len = path.node().getTotalLength?.() ?? 100;
      path.attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
        .transition().duration(600).ease(d3.easeQuadOut)
        .attr('stroke-dashoffset', 0);

      // Dots
      chart.selectAll(null).data(data).enter().append('circle')
        .attr('cx', (d, i) => x(i)).attr('cy', d => y(d))
        .attr('r', 3).attr('fill', color).attr('opacity', 0.9);
    });
  }

  function renderGenCards(metrics, currentGeneration) {
    const container = document.getElementById('gen-cards');
    container.innerHTML = '';

    if (!metrics.generations || !metrics.generations.length) return;

    metrics.generations.forEach((gen, i) => {
      const nov = metrics.avg_novelty[i] ?? 0;
      const div = metrics.avg_diversity[i] ?? 0;
      const use = metrics.avg_usefulness[i] ?? 0;
      const isCurrent = gen === currentGeneration;

      const card = document.createElement('div');
      card.className = `gen-card${isCurrent ? ' current' : ''}`;
      card.innerHTML = `
        <div class="gen-card-header">
          <span class="gen-card-label">GEN ${gen}</span>
          <span class="gen-card-count">${isCurrent ? 'current' : ''}</span>
        </div>
        ${_scoreBar('N', 'nov', nov)}
        ${_scoreBar('D', 'div', div)}
        ${_scoreBar('U', 'use', use)}
      `;
      container.appendChild(card);
    });
  }

  function _scoreBar(label, cls, val) {
    return `
      <div class="score-bar-row">
        <span class="score-bar-label">${label}</span>
        <div class="score-bar-track">
          <div class="score-bar-fill ${cls}" style="width:${Math.round(val * 100)}%"></div>
        </div>
        <span class="score-bar-val">${val.toFixed(2)}</span>
      </div>
    `;
  }

  function renderBestIdea(idea) {
    const section = document.getElementById('best-idea-section');
    const card = document.getElementById('best-idea-card');
    if (!idea) { section.style.display = 'none'; return; }

    section.style.display = '';
    const s = idea.scores || {};
    card.innerHTML = `
      <div class="tooltip-badge ${idea.source}" style="margin-bottom:8px">${idea.source} · Gen ${idea.generation}</div>
      <div class="best-card-text">${idea.text}</div>
      ${s.usefulness_reasoning ? `<div class="best-card-reasoning">"${s.usefulness_reasoning}"</div>` : ''}
      <div class="best-scores">
        <span class="best-score"><span class="lbl">N </span><span style="color:var(--ai)">${(s.novelty ?? 0).toFixed(2)}</span></span>
        <span class="best-score"><span class="lbl">D </span><span style="color:var(--hybrid)">${(s.diversity ?? 0).toFixed(2)}</span></span>
        <span class="best-score"><span class="lbl">U </span><span style="color:var(--human)">${(s.usefulness ?? 0).toFixed(2)}</span></span>
        <span class="best-score"><span class="lbl">★ </span><span style="color:var(--gold)">${(s.combined ?? 0).toFixed(2)}</span></span>
      </div>
    `;
  }

  function renderStats(metrics) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('stat-total', metrics.total_ideas ?? 0);
    set('stat-gens', metrics.generations?.length ?? 0);
    set('stat-spread', metrics.semantic_spread != null ? metrics.semantic_spread.toFixed(2) : '—');
    set('stat-peak', metrics.peak_novelty != null ? metrics.peak_novelty.toFixed(2) : '—');
  }

  function update(metrics, currentGeneration) {
    renderChart(metrics);
    renderGenCards(metrics, currentGeneration);
    renderBestIdea(metrics.best_idea);
    renderStats(metrics);
  }

  return { update };
})();

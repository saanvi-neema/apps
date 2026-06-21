// ── Idea Evolution Lab — 3D Radial Tree ──────────────────────────────────────
// Generation 0 at center sphere, each new generation on a larger sphere shell.
// Lines connect hybrid nodes to their parents.

const Tree = (() => {
  const COLOR_INT = { ai: 0x3B8AE8, human: 0x2DB86A, hybrid: 0x8B52E0 };
  const GEN_RADII = [80, 190, 300, 400, 480];

  let graph = null;
  let gNodes = [];   // { id, idea, fx, fy, fz }
  let gLinks = [];   // { source, target }
  const positions = {};
  let onHover = null;
  let onClick = null;
  let mouseX = 0, mouseY = 0;

  function _genRadius(gen) {
    return gen < GEN_RADII.length ? GEN_RADII[gen] : 540;
  }

  function _fibSphere(n, r) {
    if (n === 0) return [];
    if (n === 1) return [{ x: 0, y: r, z: 0 }];
    const phi = Math.PI * (Math.sqrt(5) - 1);
    return Array.from({ length: n }, (_, i) => {
      const y = 1 - (i / (n - 1)) * 2;
      const rxy = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = phi * i;
      return { x: r * Math.cos(theta) * rxy, y: r * y, z: r * Math.sin(theta) * rxy };
    });
  }

  function _assignPositions(allIdeas) {
    const byGen = {};
    allIdeas.forEach(d => {
      if (!positions[d.id]) (byGen[d.generation] = byGen[d.generation] || []).push(d);
    });
    Object.entries(byGen).forEach(([gen, list]) => {
      const pts = _fibSphere(list.length, _genRadius(parseInt(gen)));
      list.forEach((idea, i) => {
        if (!positions[idea.id]) positions[idea.id] = pts[i];
      });
    });
  }

  function _assignPositionNear(idea, nearId) {
    const near = positions[nearId];
    if (!near) return false;
    const r = Math.sqrt(near.x ** 2 + near.y ** 2 + near.z ** 2);
    const perp = { x: near.z, y: 0, z: -near.x };
    const pLen = Math.sqrt(perp.x ** 2 + perp.z ** 2) || 1;
    const raw = {
      x: near.x + (perp.x / pLen) * r * 0.4,
      y: near.y + r * 0.15,
      z: near.z + (perp.z / pLen) * r * 0.4,
    };
    const newR = Math.sqrt(raw.x ** 2 + raw.y ** 2 + raw.z ** 2) || 1;
    const scale = r / newR;
    positions[idea.id] = { x: raw.x * scale, y: raw.y * scale, z: raw.z * scale };
    return true;
  }

  function _makeNodeObj(idea) {
    const nodeR = 5 + (idea.scores?.novelty ?? 0.4) * 9;
    const color = COLOR_INT[idea.source] ?? COLOR_INT.ai;
    const group = new THREE.Group();

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(nodeR, 20, 20),
      new THREE.MeshLambertMaterial({ color, transparent: true, opacity: idea.disliked ? 0.22 : 0.88 })
    );
    group.add(sphere);

    if (idea.liked) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(nodeR + 5, 1.5, 8, 32),
        new THREE.MeshLambertMaterial({ color: 0xC49A0A })
      );
      group.add(ring);
    }
    return group;
  }

  function _push() {
    if (!graph) return;
    graph.graphData({ nodes: gNodes, links: gLinks });
  }

  function init(containerEl, hoverCallback, clickCallback) {
    onHover = hoverCallback;
    onClick = clickCallback;
    gNodes = [];
    gLinks = [];
    Object.keys(positions).forEach(k => delete positions[k]);

    containerEl.innerHTML = '';
    document.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });

    graph = ForceGraph3D()(containerEl)
      .width(containerEl.clientWidth)
      .height(containerEl.clientHeight)
      .backgroundColor('#F4EFE4')
      .nodeLabel(() => '')
      .nodeThreeObject(n => _makeNodeObj(n.idea))
      .nodeThreeObjectExtend(false)
      .onNodeHover(node => {
        if (onHover) onHover(node ? { clientX: mouseX, clientY: mouseY } : null, node?.idea ?? null);
      })
      .onNodeClick((node, event) => {
        if (onClick) onClick(event, node.idea);
      })
      .linkColor(() => 'rgba(44,40,32,0.35)')
      .linkWidth(1.5)
      .linkCurvature(0.25)
      .d3Force('charge', null)
      .d3Force('center', null)
      .d3Force('link', null);

    const scene = graph.scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.5);
    dir.position.set(300, 500, 300);
    scene.add(dir);
  }

  function addGeneration(newIdeas, allIdeas) {
    _assignPositions(allIdeas);
    newIdeas.forEach(idea => {
      const pos = positions[idea.id];
      if (!pos) return;
      gNodes.push({ id: idea.id, idea, fx: pos.x, fy: pos.y, fz: pos.z });
      if (idea.source === 'hybrid') {
        idea.parent_ids.forEach(pid => gLinks.push({ source: idea.id, target: pid }));
      }
    });
    _push();
  }

  function addIdeaNear(idea, nearId, allIdeas) {
    if (!_assignPositionNear(idea, nearId)) _assignPositions([idea]);
    const pos = positions[idea.id];
    if (pos) gNodes.push({ id: idea.id, idea, fx: pos.x, fy: pos.y, fz: pos.z });
    _push();
  }

  function _updateNode(idea) {
    const node = gNodes.find(n => n.id === idea.id);
    if (node) node.idea = { ...idea };
  }

  function updateNodeScore(idea) {
    _updateNode(idea);
    _push();
  }

  function updateIdeaState(idea) {
    _updateNode(idea);
    _push();
  }

  function clear() {
    gNodes = [];
    gLinks = [];
    Object.keys(positions).forEach(k => delete positions[k]);
    if (graph) graph.graphData({ nodes: [], links: [] });
  }

  function resize(containerEl) {
    if (graph) {
      graph.width(containerEl.clientWidth);
      graph.height(containerEl.clientHeight);
    }
  }

  return { init, addGeneration, addIdeaNear, updateNodeScore, updateIdeaState, clear, resize };
})();

// ── IdeaMorph — 3D Tree (Three.js) ────────────────────────────────────────
// Replaces the flat D3 radial SVG with a navigable 3D scene.
//
// Biological metaphor:
//   • Ideas = organisms (spheres)
//   • Embeddings = genomes (position in semantic space)
//   • Generations rise upward along Y-axis like a growing phylogenetic tree
//   • Parent→child connections are DNA double helices
//   • Two small gene-donor orbs on hybrid nodes show inherited traits
//   • Node size = novelty  |  glow intensity = usefulness  |  gold ring = liked
//
// Public API (identical to the old D3 tree.js):
//   Tree.init(container, hoverCb, clickCb)
//   Tree.addGeneration(newIdeas, allIdeas)
//   Tree.addIdeaNear(idea, nearId, allIdeas)
//   Tree.updateNodeScore(idea)
//   Tree.updateIdeaState(idea)
//   Tree.clear()
//   Tree.resize(container)

const Tree = (() => {

  // ── Palette (matches CSS vars) ─────────────────────────────────────────────
  const C = {
    ai:     0x3B8AE8,   // blue
    human:  0x2DB86A,   // green
    hybrid: 0x8B52E0,   // purple
    liked:  0xC49A0A,   // gold
    bg:     0xF4EFE4,   // parchment
  };

  // ── Layout constants ───────────────────────────────────────────────────────
  const GEN_Y_STEP  = 120;   // vertical gap between generations (world units)
  const GEN_SPREAD  = 160;   // X/Z ring radius for each generation
  const NODE_R_MIN  = 7;     // sphere radius when novelty = 0
  const NODE_R_MAX  = 19;    // sphere radius when novelty = 1

  // ── Scene state ────────────────────────────────────────────────────────────
  let renderer = null;
  let scene, camera, controls, animId;
  let containerEl;
  let onHover = null, onClick = null;

  const nodeGroups = {};   // id → THREE.Group
  const positions  = {};   // id → THREE.Vector3  (never mutated once set)
  const ideaData   = {};   // id → latest idea object
  const nodeColors = {};   // id → computed hex color (reflects hereditary blending)

  // ── Geometry helpers ───────────────────────────────────────────────────────
  function _r(idea) {
    return NODE_R_MIN + (idea.scores?.novelty ?? 0.35) * (NODE_R_MAX - NODE_R_MIN);
  }

  // Base source color (used for seeds and as fallback)
  function _color(idea) {
    return C[idea.source] ?? C.ai;
  }

  // Hereditary color: hybrids blend their two parents' colors, then get a
  // slight purple tint to mark them as a hybrid generation.
  // Pure AI + pure AI → blue-purple (visibly different from a seed)
  // AI + Human → teal  |  Hybrid + Human → green-purple  |  etc.
  function _computeColor(idea) {
    if (idea.source !== 'hybrid') return C[idea.source] ?? C.ai;

    const [pA, pB] = idea.parent_ids ?? [];
    if (!pA || !pB) return C.hybrid;

    // Parents are always created before children so their colors are available
    const cA = nodeColors[pA] ?? C.ai;
    const cB = nodeColors[pB] ?? C.ai;

    // 50/50 blend of parent colors
    const blended = new THREE.Color(cA).lerp(new THREE.Color(cB), 0.5);

    // 25% purple tint — marks it as a hybrid regardless of parent colors
    blended.lerp(new THREE.Color(C.hybrid), 0.25);

    return blended.getHex();
  }

  // ── Bootstrap (called once) ────────────────────────────────────────────────
  function _bootstrap(container) {
    containerEl = container;
    const w = container.clientWidth  || 800;
    const h = container.clientHeight || 600;

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(C.bg);
    scene.fog = new THREE.FogExp2(C.bg, 0.0015);

    // Camera
    camera = new THREE.PerspectiveCamera(55, w / h, 1, 3000);
    camera.position.set(0, 60, 440);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    container.appendChild(renderer.domElement);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 0.95);
    sun.position.set(150, 350, 200);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xfff0dd, 0.3);
    fill.position.set(-120, -80, -100);
    scene.add(fill);

    // OrbitControls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping  = true;
    controls.dampingFactor  = 0.06;
    controls.minDistance    = 60;
    controls.maxDistance    = 1400;
    controls.target.set(0, 80, 0);
    controls.update();

    // Mouse events on the canvas
    renderer.domElement.addEventListener('mousemove', _onMove);
    renderer.domElement.addEventListener('click',     _onClick);
    renderer.domElement.addEventListener('click',     _onCanvasClick);

    // Kick off render loop
    _loop();
  }

  function _loop() {
    animId = requestAnimationFrame(_loop);
    controls.update();
    renderer.render(scene, camera);
  }

  // ── Lights helper (re-added after clear) ──────────────────────────────────
  function _addLights() {
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 0.95);
    sun.position.set(150, 350, 200);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xfff0dd, 0.3);
    fill.position.set(-120, -80, -100);
    scene.add(fill);
  }

  // ── Position assignment ────────────────────────────────────────────────────
  // Uses semantic_angle (from PCA in backend) to place ideas on X/Z ring.
  // Ideas already positioned are never moved.
  function _assignPositions(ideas) {
    const byGen = {};
    ideas.forEach(d => {
      if (!positions[d.id]) {
        (byGen[d.generation] = byGen[d.generation] || []).push(d);
      }
    });

    Object.entries(byGen).forEach(([gen, list]) => {
      const g = +gen;
      const y = g * GEN_Y_STEP;
      const r = (list.length === 1 && g === 0) ? 0 : GEN_SPREAD;

      list.forEach((idea, i) => {
        const angle = (idea.semantic_angle != null)
          ? idea.semantic_angle
          : (i / list.length) * Math.PI * 2;
        positions[idea.id] = new THREE.Vector3(
          r * Math.cos(angle), y, r * Math.sin(angle),
        );
      });
    });
  }

  // ── DNA double-helix connection ────────────────────────────────────────────
  // Draws two intertwined tube strands (colored by each parent) with rungs
  // between them — a visible double helix representing genetic inheritance.
  function _drawHelix(from, to, colStrand1, colStrand2) {
    const dir    = new THREE.Vector3().subVectors(to, from);
    const length = dir.length();
    if (length < 1) return;

    const turns = Math.max(2, Math.round(length / 30));
    const steps = turns * 18;

    // Build a local coordinate frame along the helix axis
    const ax = dir.clone().normalize();
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(ax.dot(up)) > 0.98) up.set(1, 0, 0);
    const bx = new THREE.Vector3().crossVectors(ax, up).normalize();
    const by = new THREE.Vector3().crossVectors(ax, bx).normalize();

    const HR = 5;   // helix strand radius from axis
    const pts1 = [], pts2 = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = t * turns * Math.PI * 2;
      const center = new THREE.Vector3().lerpVectors(from, to, t);

      pts1.push(center.clone()
        .addScaledVector(bx, Math.cos(a) * HR)
        .addScaledVector(by, Math.sin(a) * HR));

      pts2.push(center.clone()
        .addScaledVector(bx, Math.cos(a + Math.PI) * HR)
        .addScaledVector(by, Math.sin(a + Math.PI) * HR));
    }

    const curve1 = new THREE.CatmullRomCurve3(pts1);
    const curve2 = new THREE.CatmullRomCurve3(pts2);

    const m1 = new THREE.MeshPhongMaterial({ color: colStrand1, transparent: true, opacity: 0.78 });
    const m2 = new THREE.MeshPhongMaterial({ color: colStrand2, transparent: true, opacity: 0.78 });

    scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve1, steps * 2, 0.9, 6, false), m1));
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve2, steps * 2, 0.9, 6, false), m2));

    // Rungs (base pairs) connecting the two strands
    const rungEvery = Math.max(1, Math.floor(steps / (turns * 3)));
    const rungMat = new THREE.LineBasicMaterial({ color: 0xBBB3A0, transparent: true, opacity: 0.38 });
    for (let i = 0; i <= steps; i += rungEvery) {
      const t = i / steps;
      const geo = new THREE.BufferGeometry().setFromPoints([curve1.getPoint(t), curve2.getPoint(t)]);
      scene.add(new THREE.Line(geo, rungMat));
    }
  }

  // ── Node creation ──────────────────────────────────────────────────────────
  function _makeNode(idea, delayMs) {
    ideaData[idea.id] = idea;
    const pos   = positions[idea.id];
    if (!pos) return;

    const r     = _r(idea);
    const color = _computeColor(idea);
    nodeColors[idea.id] = color;   // store so children can inherit it

    const group = new THREE.Group();
    group.position.copy(pos);
    group.userData.ideaId = idea.id;

    // Main sphere
    const mat = new THREE.MeshPhongMaterial({
      color,
      emissive: new THREE.Color(color).multiplyScalar(0.22),
      shininess: 75,
      transparent: true,
      opacity: idea.disliked ? 0.22 : 0.88,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 32), mat);
    sphere.name = 'main';
    group.add(sphere);

    // Hybrid: two small gene-donor orbs in each parent's actual color
    if (idea.source === 'hybrid') {
      const [pA, pB] = idea.parent_ids ?? [];
      const cA = nodeColors[pA] ?? C.ai;
      const cB = nodeColors[pB] ?? C.ai;
      _addGeneOrbs(group, r, cA, cB);
    }

    // Liked gold ring
    if (idea.liked) _addLikedRing(group, r);

    // Entrance pop animation
    group.scale.setScalar(0);
    nodeGroups[idea.id] = group;
    scene.add(group);
    setTimeout(() => _pop(group), delayMs ?? 0);
  }

  // Two small orbiting orbs — one in each parent's color —
  // representing the two gene donors of a hybrid idea.
  function _addGeneOrbs(group, r, colorA, colorB) {
    [[-1, colorA], [+1, colorB]].forEach(([sign, col]) => {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(r * 0.3, 14, 14),
        new THREE.MeshPhongMaterial({
          color: col,
          emissive: new THREE.Color(col).multiplyScalar(0.45),
        }),
      );
      orb.position.set(sign * (r + 5), r * 0.15, 0);
      orb.name = 'gene-orb';
      group.add(orb);
    });
  }

  function _addLikedRing(group, r) {
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(r + 7, 1.4, 8, 48),
      new THREE.MeshBasicMaterial({ color: C.liked }),
    );
    torus.name = 'liked-ring';
    group.add(torus);
  }

  // Elastic pop-in (scale 0 → 1)
  function _pop(group) {
    const start = performance.now();
    const dur   = 500;
    (function step() {
      const t = Math.min((performance.now() - start) / dur, 1);
      // Elastic ease-out — same feel as the old D3 easeElasticOut
      const scale = t === 1 ? 1
        : 1 - Math.pow(2, -10 * t) * Math.cos((t * 10 - 0.75) * (2 * Math.PI) / 3);
      group.scale.setScalar(scale);
      if (t < 1) requestAnimationFrame(step);
    })();
  }

  // ── Raycasting for hover / click ───────────────────────────────────────────
  const _ray   = new THREE.Raycaster();
  const _mouse = new THREE.Vector2();
  let   _hoverId = null;

  function _hit(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    _mouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
    _mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
    _ray.setFromCamera(_mouse, camera);

    const meshes = Object.values(nodeGroups)
      .map(g => g.getObjectByName('main'))
      .filter(Boolean);

    const hits = _ray.intersectObjects(meshes);
    if (!hits.length) return null;
    const id = hits[0].object.parent.userData.ideaId;
    return ideaData[id] ?? null;
  }

  function _onMove(event) {
    const idea = _hit(event);
    if (idea) {
      if (_hoverId !== idea.id) {
        _hoverId = idea.id;
        renderer.domElement.style.cursor = 'pointer';
      }
      if (onHover) onHover(event, idea);
    } else {
      if (_hoverId) {
        _hoverId = null;
        renderer.domElement.style.cursor = '';
      }
      if (onHover) onHover(null, null);
    }
  }

  function _onClick(event) {
    const idea = _hit(event);
    if (idea && onClick) {
      event.stopPropagation();
      _glowLineage(idea);
      onClick(event, idea);
    }
  }

  // Click on empty space → reset all ancestry glows
  function _onCanvasClick(event) {
    const idea = _hit(event);
    if (!idea) _resetGlow();
  }

  // Highlight all ancestors of the clicked idea back to gen 0.
  // Previously glowed nodes are dimmed back to normal first.
  let _glowedIds = [];

  function _resetGlow() {
    _glowedIds.forEach(id => {
      const group = nodeGroups[id];
      if (!group) return;
      const sphere = group.getObjectByName('main');
      if (sphere) {
        sphere.material.emissive.set(
          new THREE.Color(_color(ideaData[id])).multiplyScalar(0.22),
        );
        sphere.material.emissiveIntensity = 1;
      }
    });
    _glowedIds = [];
  }

  function _glowLineage(idea) {
    _resetGlow();

    // Walk up the ancestry tree via parent_ids
    const toVisit = [...(idea.parent_ids ?? [])];
    const visited = new Set();

    while (toVisit.length) {
      const id = toVisit.pop();
      if (visited.has(id)) continue;
      visited.add(id);

      const ancestor = ideaData[id];
      if (!ancestor) continue;

      const group = nodeGroups[id];
      if (group) {
        const sphere = group.getObjectByName('main');
        if (sphere) {
          // Bright white-gold pulse to mark the ancestor
          sphere.material.emissive.set(new THREE.Color(0xFFD966));
          sphere.material.emissiveIntensity = 1.8;
          _glowedIds.push(id);
        }
      }

      // Keep walking up
      (ancestor.parent_ids ?? []).forEach(pid => {
        if (!visited.has(pid)) toVisit.push(pid);
      });
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function init(container, hoverCb, clickCb) {
    onHover = hoverCb;
    onClick = clickCb;

    if (!renderer) {
      _bootstrap(container);
    } else {
      // New session: wipe ALL state so nothing bleeds across sessions
      _fullClear();
      containerEl = container;
      camera.position.set(0, 60, 440);
      controls.target.set(0, 80, 0);
      controls.update();
    }
  }

  // Wipes scene objects AND all tracking dictionaries.
  // Used by both init() (new session) and clear() (reset button).
  function _fullClear() {
    const toRemove = [];
    scene.traverse(o => { if (!o.isLight && o !== scene) toRemove.push(o); });
    toRemove.forEach(o => {
      o.geometry?.dispose();
      o.material?.dispose();
      scene.remove(o);
    });
    _addLights();

    Object.keys(nodeGroups).forEach(k => delete nodeGroups[k]);
    Object.keys(positions).forEach(k => delete positions[k]);
    Object.keys(ideaData).forEach(k => delete ideaData[k]);
    Object.keys(nodeColors).forEach(k => delete nodeColors[k]);
    _glowedIds = [];
    _hoverId   = null;

    console.log('[IdeaMorph] scene cleared');
  }

  function addGeneration(newIdeas, allIdeas) {
    _assignPositions(allIdeas);

    // Draw DNA helices for hybrid nodes before spawning them
    newIdeas.forEach(idea => {
      if (idea.source !== 'hybrid' || idea.parent_ids.length < 2) return;
      const [pA, pB] = idea.parent_ids;
      const posA = positions[pA], posB = positions[pB], posC = positions[idea.id];
      if (posA && posC) {
        _drawHelix(posA, posC, nodeColors[pA] ?? C.ai, nodeColors[idea.id] ?? C.hybrid);
      }
      if (posB && posC) {
        _drawHelix(posB, posC, nodeColors[pB] ?? C.ai, nodeColors[idea.id] ?? C.hybrid);
      }
    });

    // Spawn nodes with a stagger so they pop in one by one
    newIdeas.forEach((idea, i) => _makeNode(idea, 100 + i * 90));
  }

  function addIdeaNear(idea, nearId, allIdeas) {
    const near = positions[nearId];
    if (near) {
      // Place human ideas on an inner ring (radius 100) at the same angle
      // as their nearest neighbor. Different radius guarantees no overlap
      // from any camera angle, and keeps them visually close to their
      // semantic neighbor without sitting on top of it.
      const angle = Math.atan2(near.z, near.x);
      positions[idea.id] = new THREE.Vector3(
        100 * Math.cos(angle), near.y, 100 * Math.sin(angle),
      );
    } else {
      _assignPositions(allIdeas);
    }
    _makeNode(idea, 80);
  }

  function updateNodeScore(idea) {
    ideaData[idea.id] = idea;
    const group = nodeGroups[idea.id];
    if (!group) return;

    const sphere = group.getObjectByName('main');
    if (sphere) {
      // Resize sphere to reflect new novelty score
      const r = _r(idea);
      sphere.geometry.dispose();
      sphere.geometry = new THREE.SphereGeometry(r, 32, 32);

      // Brighter emissive = more useful
      const u = idea.scores?.usefulness ?? 0.35;
      sphere.material.emissive.set(
        new THREE.Color(_color(idea)).multiplyScalar(0.08 + u * 0.45),
      );

      // Keep liked ring scaled correctly
      const ring = group.getObjectByName('liked-ring');
      if (ring) { ring.geometry.dispose(); ring.geometry = new THREE.TorusGeometry(r + 7, 1.4, 8, 48); }
    }
  }

  function updateIdeaState(idea) {
    ideaData[idea.id] = idea;
    const group = nodeGroups[idea.id];
    if (!group) return;

    // Opacity for disliked
    const sphere = group.getObjectByName('main');
    if (sphere) sphere.material.opacity = idea.disliked ? 0.22 : 0.88;

    // Liked ring: remove old, add new
    const old = group.getObjectByName('liked-ring');
    if (old) { old.geometry.dispose(); old.material.dispose(); group.remove(old); }
    if (idea.liked) _addLikedRing(group, _r(idea));
  }

  function clear() {
    _fullClear();
    camera.position.set(0, 60, 440);
    controls.target.set(0, 80, 0);
    controls.update();
  }

  function resize(container) {
    containerEl = container;
    if (!renderer) return;
    const w = container.clientWidth  || 800;
    const h = container.clientHeight || 600;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  // ── Debug helper ───────────────────────────────────────────────────────────
  // In browser console type: copy(JSON.stringify(IdeaMorphDebug(), null, 2))
  // Then paste the output to Claude.
  window.IdeaMorphDebug = () => ({
    nodeCount:     Object.keys(nodeGroups).length,
    positionCount: Object.keys(positions).length,
    ideaCount:     Object.keys(ideaData).length,
    ideas: Object.values(ideaData).map(d => ({
      id:         d.id.slice(0, 8),
      generation: d.generation,
      source:     d.source,
      parent_ids: (d.parent_ids ?? []).map(p => p.slice(0, 8)),
      color:      '#' + (nodeColors[d.id] ?? 0).toString(16).padStart(6, '0'),
      text:       d.text.slice(0, 60),
    })),
    sceneChildren: scene.children.length,
  });

  return { init, addGeneration, addIdeaNear, updateNodeScore, updateIdeaState, clear, resize };
})();

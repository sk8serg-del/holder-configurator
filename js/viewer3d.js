/*
 * viewer3d.js — 3D-просмотр раскладки (Three.js, js/vendor/three.min.js).
 *
 * HC.viewer3d.available()      — загружена ли библиотека Three.js;
 * HC.viewer3d.update(host, model) — построить/обновить вид в контейнере;
 *   возвращает false, если WebGL недоступен.
 * model — как у HC.renderSVG, плюс thickness (толщина диска, мм).
 *
 * Диск строится «слоями» без CSG: толщина делится по всем встречающимся
 * глубинам посадок; в каждом слое отверстия — контуры (посадка + паз) тех
 * элементов, что прорезают слой, либо их сквозные зоны CA. Сложенные слои
 * выглядят как настоящие ступенчатые отверстия. Принадлежность отверстия
 * показана цветом внутренних стенок counterbore (посадка + стенка CA),
 * контрольные отверстия — серыми стенками; дно и поверхность — алюминий.
 */
(function (g) {
  "use strict";
  var HC = (g.HC = g.HC || {});

  var PART_COLORS = [0x2b6cb0, 0x2f855a, 0xc05621, 0x6b46c1, 0xc53030];
  var CTRL_COLOR = 0x9b111e; // контрольные отверстия — рубиновые стенки counterbore

  var st = null; // единственный экземпляр: {renderer, scene, camera, group, host, sph, ...}

  // ---------- геометрия контуров ----------

  function circlePoly(cx, cy, r, n) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  // Радиальная протяжённость капсулы (стадиона) вдоль направления (c,s):
  // капсула — отрезок [-hs, hs] по X, «раздутый» на радиус w.
  function capsuleRadial(c, s, hs, w) {
    var uc = Math.abs(c), us = Math.abs(s);
    if (us > 1e-9 && (w / us) * uc <= hs) return w / us;      // боковая прямая
    var disc = w * w - hs * hs * us * us;                      // торцевая дуга
    return uc * hs + Math.sqrt(Math.max(0, disc));
  }

  // Контур «посадка ∪ паз»: обе фигуры звёздные относительно общего центра,
  // поэтому границу объединения можно снять по лучам: r(θ) = max(круг, капсула).
  function seatOutline(cx, cy, D, slotOn, slotAngleRad) {
    var R = D / 2;
    var n = 96;
    if (!slotOn) return circlePoly(cx, cy, R, n);
    var L = D + 2 * 2.5;                       // длина паза
    var W = Math.min(9, D * 0.75);             // ширина паза
    var hs = Math.max(0, L / 2 - W / 2);
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      var la = a - slotAngleRad;               // угол в системе паза
      var r = Math.max(R, capsuleRadial(Math.cos(la), Math.sin(la), hs, W / 2));
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function toShape(pts) {
    var s = new g.THREE.Shape();
    s.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) s.lineTo(pts[i].x, pts[i].y);
    s.closePath();
    return s;
  }

  function toPath(pts) {
    var p = new g.THREE.Path();
    p.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    p.closePath();
    return p;
  }

  // ---------- элементы (детали + контрольные отверстия) → карманы ----------

  // Каждый элемент: {outline, depth, ca: {cx,cy,r}|null, color}
  function collectFeatures(model) {
    var T = model.thickness;
    var defDepth = Math.max(0.5, T - 1.5); // стандартная глубина посадки
    var fs = [];

    (model.controlHoles || []).forEach(function (h) {
      var seat = h.seatD > 0 ? h.seatD : h.d;
      if (!(seat > 0)) return;
      var ang = Math.atan2(h.y, h.x);
      fs.push({
        outline: seatOutline(h.x, h.y, seat, !!h.slotOn, ang),
        depth: h.depth > 0 ? h.depth : defDepth,
        ca: h.apertureCA > 0 ? { cx: h.x, cy: h.y, r: h.apertureCA / 2 } : null,
        color: CTRL_COLOR
      });
    });

    (model.placed || []).forEach(function (p) {
      var color = PART_COLORS[(p.partIndex || 0) % PART_COLORS.length];
      if (p.type === "circle") {
        var seat = p.seatD > 0 ? p.seatD : p.d;
        var ang = Math.atan2(p.cy, p.cx);
        fs.push({
          outline: seatOutline(p.cx, p.cy, seat, !!p.slotOn, ang),
          depth: defDepth,
          ca: p.apertureCA > 0 ? { cx: p.cx, cy: p.cy, r: p.apertureCA / 2 } : null,
          color: color
        });
      } else {
        fs.push({
          outline: HC.geom.placementPoly(p),
          depth: defDepth,
          ca: null,
          color: color
        });
      }
    });
    return fs;
  }

  // Боковая поверхность контура от z0 до z1, слегка втянутая внутрь (inset),
  // чтобы цветная стенка не мерцала поверх серой стенки слоя диска.
  function wallGeometry(pts, z0, z1, inset) {
    var cx = 0, cy = 0;
    pts.forEach(function (p) { cx += p.x; cy += p.y; });
    cx /= pts.length; cy /= pts.length;
    var q = pts.map(function (p) {
      var dx = cx - p.x, dy = cy - p.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var k = Math.min(1, inset / len);
      return { x: p.x + dx * k, y: p.y + dy * k };
    });
    var pos = [];
    for (var i = 0; i < q.length; i++) {
      var a = q[i], b = q[(i + 1) % q.length];
      pos.push(a.x, a.y, z0, b.x, b.y, z0, b.x, b.y, z1);
      pos.push(a.x, a.y, z0, b.x, b.y, z1, a.x, a.y, z1);
    }
    var geo = new g.THREE.BufferGeometry();
    geo.setAttribute("position", new g.THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  // ---------- сборка сцены ----------

  function buildGroup(model) {
    var THREE = g.THREE;
    var T = model.thickness > 0 ? model.thickness : 6;
    var R = model.discDiameter / 2;
    var eps = 1e-6;
    var group = new THREE.Group();

    var features = collectFeatures(model).map(function (f) {
      f.depth = Math.min(Math.max(f.depth, 0.3), T);
      f.through = f.depth >= T - eps;
      return f;
    });

    // границы слоёв: 0, все глубины посадок, толщина
    var bounds = [0, T];
    features.forEach(function (f) { if (!f.through) bounds.push(f.depth); });
    bounds.sort(function (a, b) { return a - b; });
    bounds = bounds.filter(function (v, i, arr) { return i === 0 || v - arr[i - 1] > eps; });

    var discMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd1, metalness: 0.55, roughness: 0.5 });

    for (var i = 0; i + 1 < bounds.length; i++) {
      var t0 = bounds[i], t1 = bounds[i + 1];
      var shape = toShape(circlePoly(0, 0, R, 128));
      features.forEach(function (f) {
        if (f.through || f.depth >= t1 - eps) {
          shape.holes.push(toPath(f.outline));            // слой внутри кармана
        } else if (f.ca) {
          shape.holes.push(toPath(circlePoly(f.ca.cx, f.ca.cy, f.ca.r, 64))); // сквозная CA
        }
      });
      var geo = new THREE.ExtrudeGeometry(shape, { depth: t1 - t0, bevelEnabled: false, curveSegments: 4 });
      var mesh = new THREE.Mesh(geo, discMat);
      mesh.position.z = -t1;
      group.add(mesh);
    }

    // принадлежность отверстия — цветом внутренних стенок counterbore:
    // стенка посадки (с пазом) на глубину, ниже неё — стенка сквозной CA
    var wallMats = {};
    function matFor(color) {
      if (!wallMats[color]) {
        wallMats[color] = new THREE.MeshStandardMaterial({
          color: color, metalness: 0.15, roughness: 0.55, side: THREE.DoubleSide
        });
      }
      return wallMats[color];
    }
    var inset = 0.05; // втягивание цветной стенки внутрь, мм
    features.forEach(function (f) {
      var zSeat = -Math.min(f.depth, T);
      group.add(new THREE.Mesh(wallGeometry(f.outline, 0, zSeat, inset), matFor(f.color)));
      if (!f.through && f.ca) {
        group.add(new THREE.Mesh(
          wallGeometry(circlePoly(f.ca.cx, f.ca.cy, f.ca.r, 64), zSeat, -T, inset),
          matFor(f.color)
        ));
      }
      if (!f.through) {
        // ступенька — дно посадки: контур посадки с вырезом CA, чуть выше
        // серого дна слоя, чтобы не мерцать
        var floor = toShape(f.outline);
        if (f.ca) floor.holes.push(toPath(circlePoly(f.ca.cx, f.ca.cy, f.ca.r, 64)));
        var mesh = new THREE.Mesh(new THREE.ShapeGeometry(floor), matFor(f.color));
        mesh.position.z = zSeat + 0.02;
        group.add(mesh);
      }
    });

    // номера позиций — спрайты над деталями (повёрнуты к камере всегда)
    if (model.showNumbers) {
      (model.placed || []).forEach(function (p, idx) {
        var size = p.type === "circle" ? p.d : Math.min(p.w, p.h);
        var fs2 = Math.max(4, Math.min(R / 9, size * 0.8));
        var spr = numberSprite(String(idx + 1));
        spr.position.set(p.cx, p.cy, 2);
        spr.scale.set(fs2, fs2, 1);
        group.add(spr);
      });
    }
    return group;
  }

  function numberSprite(text) {
    var THREE = g.THREE;
    var c = document.createElement("canvas");
    c.width = c.height = 96;
    var ctx = c.getContext("2d");
    ctx.beginPath();
    ctx.arc(48, 48, 44, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#5a6470";
    ctx.stroke();
    ctx.fillStyle = "#1a3550";
    ctx.font = "bold " + (text.length > 2 ? 34 : 44) + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 48, 50);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  }

  // ---------- рендерер, камера, управление ----------

  function initOnce(host) {
    var THREE = g.THREE;
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) {
      return null; // WebGL недоступен
    }
    renderer.setPixelRatio(Math.min(2, g.devicePixelRatio || 1));
    renderer.outputEncoding = THREE.sRGBEncoding;
    host.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x50555c, 0.9));
    var sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(150, -220, 320);
    scene.add(sun);
    var back = new THREE.DirectionalLight(0xffffff, 0.25);
    back.position.set(-180, 200, -120);
    scene.add(back);

    var camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    camera.up.set(0, 0, 1);

    var s = {
      renderer: renderer, scene: scene, camera: camera, host: host,
      group: null, pending: false,
      // сферические координаты камеры вокруг центра диска
      sph: { r: 500, theta: -Math.PI / 2, phi: Math.PI / 4 },
      rMin: 50, rMax: 2000
    };

    function applyCamera() {
      var q = s.sph;
      camera.position.set(
        q.r * Math.sin(q.phi) * Math.cos(q.theta),
        q.r * Math.sin(q.phi) * Math.sin(q.theta),
        q.r * Math.cos(q.phi)
      );
      camera.lookAt(0, 0, 0);
    }
    function requestRender() {
      if (s.pending) return;
      s.pending = true;
      g.requestAnimationFrame(function () {
        s.pending = false;
        applyCamera();
        renderer.render(scene, camera);
      });
    }
    s.requestRender = requestRender;

    function resize() {
      var w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      requestRender();
    }
    s.resize = resize;
    g.addEventListener("resize", resize);

    // управление: перетаскивание — вращение, колесо/пинч — масштаб
    var el = renderer.domElement;
    el.style.touchAction = "none";
    var drag = null, pinch = null, pointers = {};
    el.addEventListener("pointerdown", function (e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 1) drag = { x: e.clientX, y: e.clientY };
      else if (ids.length === 2) {
        drag = null;
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2 && pinch != null) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d2 = Math.hypot(a.x - b.x, a.y - b.y);
        if (d2 > 0) {
          s.sph.r = Math.min(s.rMax, Math.max(s.rMin, s.sph.r * (pinch / d2)));
          pinch = d2;
          requestRender();
        }
      } else if (drag) {
        s.sph.theta -= (e.clientX - drag.x) * 0.008;
        s.sph.phi = Math.min(Math.PI - 0.08, Math.max(0.08, s.sph.phi - (e.clientY - drag.y) * 0.008));
        drag = { x: e.clientX, y: e.clientY };
        requestRender();
      }
    });
    function up(e) {
      delete pointers[e.pointerId];
      var ids = Object.keys(pointers);
      pinch = null;
      drag = ids.length === 1 ? { x: pointers[ids[0]].x, y: pointers[ids[0]].y } : null;
    }
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", function (e) {
      e.preventDefault();
      s.sph.r = Math.min(s.rMax, Math.max(s.rMin, s.sph.r * Math.exp(e.deltaY * 0.001)));
      requestRender();
    }, { passive: false });

    return s;
  }

  function disposeGroup(group) {
    group.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }

  HC.viewer3d = {
    available: function () { return typeof g.THREE !== "undefined"; },
    _buildGroup: buildGroup, // для тестов (node, без WebGL)

    // Построить/обновить 3D-вид. host должен быть видим (нужны его размеры).
    update: function (host, model) {
      if (!this.available()) return false;
      if (!st) {
        st = initOnce(host);
        if (!st) return false;
        // стартовая дистанция — по диаметру диска
        st.sph.r = model.discDiameter * 1.5;
        st.rMin = model.discDiameter * 0.25;
        st.rMax = model.discDiameter * 5;
      }
      if (st.group) {
        st.scene.remove(st.group);
        disposeGroup(st.group);
      }
      st.group = buildGroup(model);
      st.scene.add(st.group);
      st.resize();
      st.requestRender();
      return true;
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : window);

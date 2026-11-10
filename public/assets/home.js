/**
 * Presence. — Home Interactive Engine (Worker C)
 * Reusable WebGL Red Spider Lily (Lycoris radiata) Engine,
 * 2-Second Automatic Bloom & Settle, Offscreen / Visibility Pause,
 * Static Fallback Handling, and Legacy Hash Routing.
 */

(function () {
  'use strict';

  /* ================================================================
     1 · Legacy Hash Redirects (#book/#week -> /book; #gentleman/#practices/#word -> /about)
  ================================================================ */
  function handleLegacyHashes() {
    var hash = window.location.hash;
    if (!hash) return;
    if (hash === '#book' || hash === '#week') {
      window.location.replace('/book' + hash);
    } else if (hash === '#gentleman' || hash === '#practices' || hash === '#word' || hash === '#stewards') {
      window.location.replace('/about' + hash);
    }
  }

  window.addEventListener('hashchange', handleLegacyHashes);
  handleLegacyHashes();

  /* ================================================================
     2 · Vector & Matrix Math Utilities
  ================================================================ */
  var add = function (a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; };
  var sub = function (a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; };
  var mul = function (a, s) { return [a[0] * s, a[1] * s, a[2] * s]; };
  var dot = function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
  var cross = function (a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  };
  var norm = function (a) {
    var l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  var rng = function (seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  var clamp01 = function (x) { return x <= 0 ? 0 : x > 1 ? 1 : x; };
  var HEART = [0, 0.25, 0];

  /* Matrices (column-major) */
  var perspective = function (fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2);
    var m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) / (near - far);
    m[11] = -1;
    m[14] = (2 * far * near) / (near - far);
    return m;
  };

  var lookAt = function (eye, at) {
    var z = norm(sub(eye, at));
    var x = norm(cross([0, 1, 0], z));
    var y = cross(z, x);
    var m = new Float32Array(16);
    m[0] = x[0];  m[4] = x[1];  m[8] = x[2];
    m[1] = y[0];  m[5] = y[1];  m[9] = y[2];
    m[2] = z[0];  m[6] = z[1];  m[10] = z[2];
    m[12] = -dot(x, eye);
    m[13] = -dot(y, eye);
    m[14] = -dot(z, eye);
    m[15] = 1;
    return m;
  };

  var multiply = function (a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        o[c * 4 + r] =
          a[r] * b[c * 4] +
          a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] +
          a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  };

  var rotY = function (t) {
    var c = Math.cos(t), s = Math.sin(t);
    return new Float32Array([
      c, 0, -s, 0,
      0, 1,  0, 0,
      s, 0,  c, 0,
      0, 0,  0, 1
    ]);
  };

  var rotX = function (t) {
    var c = Math.cos(t), s = Math.sin(t);
    return new Float32Array([
      1, 0,  0, 0,
      0, c,  s, 0,
      0, -s, c, 0,
      0, 0,  0, 1
    ]);
  };

  var hexToLinear = function (hex) {
    var h = hex.replace('#', '').trim();
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h.slice(0, 6), 16);
    if (Number.isNaN(n)) return [0.8, 0.02, 0.03];
    var ch = function (v) { return Math.pow(v / 255, 2.2); };
    return [ch((n >> 16) & 255), ch((n >> 8) & 255), ch(n & 255)];
  };

  /* ================================================================
     3 · Geometry Generation (Lycoris radiata curves & mesh)
  ================================================================ */
  function buildCurves(florets, seed) {
    var F = Math.max(3, Math.min(8, Math.round(florets)));
    var r = rng(seed);
    var curves = [];
    var up = [0, 1, 0];

    for (var i = 0; i < F; i++) {
      var phi = (i / F) * Math.PI * 2 + (r() - 0.5) * 0.3;
      var tilt = 1.05 + (r() - 0.5) * 0.25;
      var radial = [Math.cos(phi), 0, Math.sin(phi)];
      var u = norm([Math.sin(tilt) * radial[0], Math.cos(tilt), Math.sin(tilt) * radial[2]]);
      var base = [radial[0] * 0.13, 0.07, radial[2] * 0.13];
      var e1 = norm(cross(u, Math.abs(u[1]) > 0.9 ? [1, 0, 0] : up));
      var e2 = cross(u, e1);
      var stagger = i / F;

      // Pedicel
      var ped = [];
      for (var k = 0; k <= 10; k++) {
        var s = k / 10;
        ped.push([radial[0] * 0.13 * s, 0.07 * Math.sin(s * Math.PI / 2), radial[2] * 0.13 * s]);
      }
      curves.push({ pts: ped, kind: 2, w: 0.022, t: 0, lat: e1, twist: 0, bulb: false, phase: 0, base: base, stagger: stagger });

      // Tepals and stamens (6 per floret)
      for (var j = 0; j < 6; j++) {
        var th = (j / 6) * Math.PI * 2 + i * 0.7 + (r() - 0.5) * 0.35;
        var d = add(mul(e1, Math.cos(th)), mul(e2, Math.sin(th)));
        var lat = norm(cross(d, u));
        var phase = r() * Math.PI * 2;

        // Tepal
        var L = 1.35 + r() * 0.3, b0 = 0.45 + r() * 0.2, b1 = 2.75 + r() * 0.45;
        var pts = [base];
        var p = base;
        var steps = 48;
        for (var step = 1; step <= steps; step++) {
          var st = step / steps;
          var b = b0 + (b1 - b0) * Math.pow(st, 1.2);
          p = add(p, mul(add(mul(d, Math.sin(b)), mul(u, Math.cos(b))), L / steps));
          pts.push(p);
        }
        for (var step2 = 1; step2 <= steps; step2++) {
          var st2 = step2 / steps;
          pts[step2] = add(pts[step2], mul(lat, Math.sin(st2 * Math.PI * 2.4 + phase) * 0.05 * st2));
        }
        curves.push({ pts: pts, kind: 0, w: 0.075 + r() * 0.02, t: 0.02, lat: lat, twist: 0.2 + r() * 0.35, bulb: false, phase: phase, base: base, stagger: stagger });

        // Stamen filament with anther bulb
        var d2 = add(mul(e1, Math.cos(th + 0.52)), mul(e2, Math.sin(th + 0.52)));
        var dh = norm([d2[0], 0, d2[2]]);
        var start = norm(add(u, mul(d2, 0.25)));
        var end = norm(add(add(mul(radial, 0.85), mul(dh, 0.5)), [0, -0.95, 0]));
        var Ls = 1.75 + r() * 0.45;
        var sp = [base];
        p = base;
        for (var k2 = 1; k2 <= 44; k2++) {
          var sm = k2 / 44;
          var m = Math.pow(sm, 1.15);
          p = add(p, mul(norm(add(mul(start, 1 - m), mul(end, m))), Ls / 44));
          sp.push(p);
        }
        curves.push({ pts: sp, kind: 1, w: 0.012, t: 0, lat: twistLat(e1, e2, th), twist: 0, bulb: true, phase: phase + 1.3, base: base, stagger: stagger });
      }

      // Style
      var styleEnd = norm(add(mul(radial, 0.9), [0, -0.35, 0]));
      var stylePts = [base];
      p = base;
      var styleLs = 2.2 + r() * 0.3;
      for (var k3 = 1; k3 <= 44; k3++) {
        var s3 = k3 / 44;
        p = add(p, mul(norm(add(mul(u, 1 - s3), mul(styleEnd, s3))), styleLs / 44));
        stylePts.push(p);
      }
      curves.push({ pts: stylePts, kind: 1, w: 0.009, t: 0, lat: e1, twist: 0, bulb: false, phase: r() * 6, base: base, stagger: stagger });
    }

    // Scape stem
    var stem = [];
    for (var k4 = 0; k4 <= 40; k4++) {
      var s4 = k4 / 40;
      var y = 0.04 - s4 * 4.6;
      stem.push([Math.sin(s4 * 2.2) * 0.07, y, Math.sin(s4 * 1.3) * 0.03]);
    }
    curves.push({ pts: stem, kind: 2, w: 0.05, t: 0, lat: [1, 0, 0], twist: 0, bulb: false, phase: 0, stagger: 0, base: [0, 0, 0] });

    var radius = 0;
    for (var cIdx = 0; cIdx < curves.length; cIdx++) {
      var cur = curves[cIdx];
      if (cur.kind === 2) continue;
      for (var pIdx = 0; pIdx < cur.pts.length; pIdx++) {
        var q = cur.pts[pIdx];
        radius = Math.max(radius, Math.hypot(q[0] - HEART[0], q[1] - HEART[1], q[2] - HEART[2]));
      }
    }

    return { curves: curves, radius: radius };
  }

  function twistLat(e1, e2, th) {
    return norm(cross(add(mul(e1, Math.cos(th)), mul(e2, Math.sin(th))), [0, 1, 0]));
  }

  var STRIDE = 13;
  function buildMesh(curves) {
    var v = [], idx = [];
    var count = 0;

    var push = function (p, n, s, c) {
      v.push(
        p[0], p[1], p[2],
        n[0], n[1], n[2],
        s, c.phase, c.kind, c.stagger,
        c.base[0], c.base[1], c.base[2]
      );
      return count++;
    };

    var tangent = function (pts, i) {
      return norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
    };

    for (var cIdx = 0; cIdx < curves.length; cIdx++) {
      var c = curves[cIdx];
      var n = c.pts.length;

      if (c.kind === 0) {
        // Flat strap with thickness
        var rings = [];
        var first, last, T0 = [0, 1, 0], T1 = [0, 1, 0];
        for (var i = 0; i < n; i++) {
          var s = i / (n - 1);
          var T = tangent(c.pts, i);
          var N = norm(cross(T, c.lat));
          var W = cross(N, T);
          var a = c.twist * Math.sin(Math.PI * s);
          var ca = Math.cos(a), sa = Math.sin(a);
          var W2 = add(mul(W, ca), mul(N, sa));
          N = sub(mul(N, ca), mul(W, sa));
          W = W2;

          var hw = c.w * (0.42 + 0.58 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + s * 0.9)), 0.6)) * (1 + 0.1 * Math.sin(s * 34 + c.phase));
          var p = c.pts[i];
          var k0 = add(add(p, mul(W, hw)), mul(N, c.t));
          var k1 = add(sub(p, mul(W, hw)), mul(N, c.t));
          var k2 = sub(sub(p, mul(W, hw)), mul(N, c.t));
          var k3 = sub(add(p, mul(W, hw)), mul(N, c.t));
          var mW = mul(W, -1), mN = mul(N, -1);

          rings.push([
            push(k0, N, s, c), push(k1, N, s, c),
            push(k1, mW, s, c), push(k2, mW, s, c),
            push(k2, mN, s, c), push(k3, mN, s, c),
            push(k3, W, s, c), push(k0, W, s, c)
          ]);

          if (i === 0) { first = [k0, k1, k2, k3]; T0 = T; }
          if (i === n - 1) { last = [k0, k1, k2, k3]; T1 = T; }
        }

        for (var i2 = 0; i2 < n - 1; i2++) {
          var ra = rings[i2], rb = rings[i2 + 1];
          for (var f = 0; f < 4; f++) {
            var x = f * 2;
            idx.push(ra[x], ra[x + 1], rb[x], ra[x + 1], rb[x + 1], rb[x]);
          }
        }

        var cap = function (q, nrm, sVal) {
          var o = q.map(function (pt) { return push(pt, nrm, sVal, c); });
          idx.push(o[0], o[1], o[2], o[0], o[2], o[3]);
        };
        cap(first, mul(T0, -1), 0);
        cap(last, T1, 1);
      } else {
        // Round tube on parallel-transport frame
        var seg = c.kind === 2 ? 10 : 6;
        var N2 = norm(cross(tangent(c.pts, 0), c.kind === 2 ? [0, 0, 1] : c.lat));
        var rings2 = [];

        for (var j = 0; j < n; j++) {
          var sTube = j / (n - 1);
          var TTube = tangent(c.pts, j);
          N2 = norm(sub(N2, mul(TTube, dot(N2, TTube))));
          var B = cross(TTube, N2);

          var rad = c.w * (c.kind === 1 ? 1 - 0.35 * sTube : 1);
          if (c.bulb && sTube > 0.9) {
            rad = c.w * (0.65 + 2.1 * Math.sin(((sTube - 0.9) / 0.1) * Math.PI * 0.92));
          }
          if (c.kind === 1 && j === n - 1) rad *= 0.3;

          rings2.push(count);
          for (var kSeg = 0; kSeg <= seg; kSeg++) {
            var ang = (kSeg / seg) * Math.PI * 2;
            var nr = add(mul(N2, Math.cos(ang)), mul(B, Math.sin(ang)));
            push(add(c.pts[j], mul(nr, rad)), nr, sTube, c);
          }
        }

        for (var j2 = 0; j2 < n - 1; j2++) {
          for (var kSeg2 = 0; kSeg2 < seg; kSeg2++) {
            var idxA = rings2[j2] + kSeg2;
            var idxB = rings2[j2 + 1] + kSeg2;
            idx.push(idxA, idxA + 1, idxB, idxA + 1, idxB + 1, idxB);
          }
        }
      }
    }

    return {
      data: new Float32Array(v),
      index: new Uint16Array(idx),
      vertices: count
    };
  }

  /* ================================================================
     4 · Shaders (Red Chrome Botanical Shading)
  ================================================================ */
  var VERT = [
    'attribute vec3 a_pos;',
    'attribute vec3 a_nrm;',
    'attribute vec4 a_aux;',
    'attribute vec3 a_base;',
    'uniform mat4 u_vp;',
    'uniform mat4 u_model;',
    'uniform vec2 u_offset;',
    'uniform float u_time;',
    'uniform float u_bloom;',
    'uniform float u_sway;',
    'uniform float u_stem;',
    'varying vec3 v_n;',
    'varying vec3 v_w;',
    'varying float v_s;',
    'void main() {',
    '  vec3 p = a_pos;',
    '  float k = a_aux.z;',
    '  if (k < 1.5) {',
    '    float g = clamp(u_bloom * 1.6 - a_aux.w * 0.6, 0.0, 1.0);',
    '    g = 1.0 - pow(1.0 - g, 3.0);',
    '    p = a_base + (p - a_base) * g;',
    '    float amp = (k < 0.5 ? 0.03 : 0.06) * u_sway * a_aux.x * a_aux.x;',
    '    p += amp * vec3(sin(u_time * 0.9 + a_aux.y), 0.5 * sin(u_time * 1.3 + a_aux.y * 1.7), cos(u_time * 0.7 + a_aux.y * 1.3));',
    '  } else if (p.y < 0.0) {',
    '    p.y *= u_stem;',
    '  }',
    '  vec4 w = u_model * vec4(p, 1.0);',
    '  v_w = w.xyz;',
    '  v_n = (u_model * vec4(a_nrm, 0.0)).xyz;',
    '  v_s = a_aux.x;',
    '  gl_Position = u_vp * w;',
    '  gl_Position.xy += u_offset * gl_Position.w;',
    '}'
  ].join('\n');

  var FRAG = [
    'precision highp float;',
    'uniform vec3 u_eye;',
    'uniform vec3 u_red;',
    'uniform vec3 u_hot;',
    'uniform float u_alpha;',
    'varying vec3 v_n;',
    'varying vec3 v_w;',
    'varying float v_s;',
    'float studio(vec3 r) {',
    '  float key = pow(max(dot(r, normalize(vec3(-0.45, 0.85, 0.35))), 0.0), 14.0) * 2.6;',
    '  float strip = smoothstep(0.55, 0.8, r.x) * smoothstep(-0.7, 0.3, r.y) * 1.4;',
    '  float rim = smoothstep(0.55, 0.95, -r.z) * smoothstep(-0.2, 0.5, r.y) * 0.9;',
    '  float hz = exp(-abs(r.y - 0.05) * 7.0) * 0.4;',
    '  return key + strip + rim + hz;',
    '}',
    'void main() {',
    '  vec3 n = normalize(v_n);',
    '  vec3 v = normalize(u_eye - v_w);',
    '  if (dot(n, v) < 0.0) n = -n;',
    '  vec3 r = reflect(-v, n);',
    '  float e = studio(r);',
    '  float fr = pow(1.0 - max(dot(n, v), 0.0), 3.0);',
    '  float dif = max(dot(n, normalize(vec3(-0.3, 0.8, 0.6))), 0.0);',
    '  vec3 col = u_red * (0.04 + 0.22 * dif);',
    '  col += u_red * e * 1.15;',
    '  col += u_hot * pow(e, 3.0) * 0.3;',
    '  col += u_red * fr * 1.1;',
    '  col *= 0.8 + 0.2 * smoothstep(0.0, 0.25, v_s);',
    '  col = col / (1.0 + col);',
    '  col = pow(col, vec3(1.0 / 2.2));',
    '  gl_FragColor = vec4(col * u_alpha, u_alpha);',
    '}'
  ].join('\n');

  /* ================================================================
     5 · Engine Self-Check Verification
  ================================================================ */
  function runEngineSelfCheck() {
    var n = norm([0, 3, 4]);
    if (Math.abs(n[1] - 0.6) > 1e-4 || Math.abs(n[2] - 0.8) > 1e-4) {
      throw new Error('HomeSelfCheck: vector norm math deviation');
    }
    if (clamp01(-0.2) !== 0 || clamp01(1.5) !== 1 || clamp01(0.4) !== 0.4) {
      throw new Error('HomeSelfCheck: clamp01 math deviation');
    }
    var geo = buildCurves(6, 11);
    if (!geo || !geo.curves || geo.curves.length < 50 || geo.radius <= 0) {
      throw new Error('HomeSelfCheck: curve generation deviation');
    }
    var m = buildMesh(geo.curves);
    if (!m || !m.data || !m.index || m.vertices <= 0) {
      throw new Error('HomeSelfCheck: mesh generation deviation');
    }
    return true;
  }

  try {
    runEngineSelfCheck();
  } catch (err) {
    if (window.console && console.warn) console.warn('Presence WebGL Self-Check:', err);
  }

  /* ================================================================
     6 · WebGL Spider Lily Bloom Controller
  ================================================================ */
  function initHeroLily() {
    var stage = document.getElementById('hero-lily-stage');
    var canvas = document.getElementById('hero-lily-canvas');
    if (!stage || !canvas) return;

    var mqReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    var CRIMSON = '#c9161d';
    var BLOOM_DURATION_MS = 2100;

    // Generate geometry
    var geo = buildCurves(6, 11);
    var mesh = buildMesh(geo.curves);

    var gl = null;
    var program = null;
    var vbo = null, ibo = null;
    var loc = {};

    function initGL() {
      try {
        gl = canvas.getContext('webgl', {
          alpha: true,
          antialias: true,
          premultipliedAlpha: true
        });
      } catch (e) {
        gl = null;
      }

      if (!gl) return false;

      var compile = function (type, src) {
        var sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
      };

      var vs = compile(gl.VERTEX_SHADER, VERT);
      var fs = compile(gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return false;

      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;

      gl.useProgram(program);

      vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW);

      ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.index, gl.STATIC_DRAW);

      var attr = function (name, size, off) {
        var a = gl.getAttribLocation(program, name);
        if (a < 0) return;
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, size, gl.FLOAT, false, STRIDE * 4, off * 4);
      };

      attr('a_pos', 3, 0);
      attr('a_nrm', 3, 3);
      attr('a_aux', 4, 6);
      attr('a_base', 3, 10);

      var uniforms = [
        'u_vp', 'u_model', 'u_offset', 'u_time', 'u_bloom',
        'u_sway', 'u_stem', 'u_eye', 'u_red', 'u_hot', 'u_alpha'
      ];
      for (var u = 0; u < uniforms.length; u++) {
        var uName = uniforms[u];
        loc[uName] = gl.getUniformLocation(program, uName);
      }

      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 0);
      return true;
    }

    var hasWebGL = initGL();
    if (!hasWebGL) {
      // Graceful fallback to static SVG
      return;
    }

    stage.classList.add('has-webgl');

    // Measuring & Sizing
    var W = 1, H = 1, dpr = 1;
    function measure() {
      var sr = stage.getBoundingClientRect();
      W = Math.max(1, sr.width);
      H = Math.max(1, sr.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      var cw = Math.round(W * dpr);
      var ch = Math.round(H * dpr);
      if (canvas.width !== cw || canvas.height !== chhSafe(ch)) {
        canvas.width = cw;
        canvas.height = ch;
      }
      if (isSettled) {
        drawFrame(performance.now());
      }
    }

    function chhSafe(val) { return Math.max(1, val); }

    if (window.ResizeObserver) {
      new ResizeObserver(measure).observe(stage);
    } else {
      window.addEventListener('resize', measure);
    }
    measure();

    // Camera Configuration for Hero Stage
    var key = {
      spin: 0.35,
      el: 14,
      size: 0.92,
      ox: 0.0,
      oy: 0.16,
      stem: 1.0
    };

    var pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    stage.addEventListener('pointermove', function (e) {
      var r = stage.getBoundingClientRect();
      pointer.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (isSettled) {
        pointer.x += (pointer.tx - pointer.x) * 0.2;
        pointer.y += (pointer.ty - pointer.y) * 0.2;
        drawFrame(performance.now());
      }
    });

    stage.addEventListener('pointerleave', function () {
      pointer.tx = 0;
      pointer.ty = 0;
      if (isSettled) {
        pointer.x = 0;
        pointer.y = 0;
        drawFrame(performance.now());
      }
    });

    // Animation & Lifecycle Control
    var born = performance.now();
    var last = born;
    var time = 0;
    var rafId = 0;
    var isRunning = false;
    var isOffscreen = false;
    var isTabHidden = document.hidden;
    var isSettled = mqReduced.matches;

    function drawFrame(now) {
      if (!gl || !program) return;

      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      var elapsed = now - born;
      var bloom = isSettled ? 1.0 : clamp01(elapsed / BLOOM_DURATION_MS);

      if (!isSettled) {
        time += dt;
        pointer.x += (pointer.tx - pointer.x) * (1 - Math.exp(-dt * 4));
        pointer.y += (pointer.ty - pointer.y) * (1 - Math.exp(-dt * 4));
      }

      var px = pointer.x, py = pointer.y;
      var fov = (30 * Math.PI) / 180;
      var minDim = Math.min(W, H);
      var dist = (geo.radius * H) / (key.size * minDim * Math.tan(fov / 2));
      var elRad = Math.max(-85, Math.min(85, key.el + py * 7)) * (Math.PI / 180);

      var eye = [
        HEART[0],
        HEART[1] + Math.sin(elRad) * dist,
        HEART[2] + Math.cos(elRad) * dist
      ];

      var proj = perspective(fov, W / H, Math.max(0.05, dist - 6), dist + 8);
      var vp = multiply(proj, lookAt(eye, HEART));

      // Ease gentle entrance spin during bloom, settle static
      var spinProgress = isSettled ? 1.0 : (1 - Math.exp(-elapsed / 800));
      var currentSpin = key.spin + spinProgress * 0.15 + px * 0.25;
      var model = multiply(rotY(currentSpin), rotX(py * 0.04));

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      var red = hexToLinear(CRIMSON);
      gl.uniformMatrix4fv(loc.u_vp, false, vp);
      gl.uniformMatrix4fv(loc.u_model, false, model);
      gl.uniform2f(loc.u_offset, key.ox, key.oy);
      gl.uniform1f(loc.u_time, time);
      gl.uniform1f(loc.u_bloom, bloom);
      gl.uniform1f(loc.u_sway, isSettled ? 0.0 : 1.0);
      gl.uniform1f(loc.u_stem, key.stem);
      gl.uniform3f(loc.u_eye, eye[0], eye[1], eye[2]);
      gl.uniform3f(loc.u_red, red[0] * 2.2, red[1] * 2.2, red[2] * 2.2);
      gl.uniform3f(loc.u_hot, 1.0, 0.55 + red[1], 0.5 + red[2]);
      gl.uniform1f(loc.u_alpha, 1.0);

      gl.drawElements(gl.TRIANGLES, mesh.index.length, gl.UNSIGNED_SHORT, 0);

      // Settle after approximately 2.1s bloom
      if (!isSettled && elapsed >= BLOOM_DURATION_MS + 150) {
        isSettled = true;
        stopLoop();
        // Render one crisp settled static frame
        drawFrame(now);
      }
    }

    function loop(now) {
      if (!isRunning) return;
      drawFrame(now);
      if (!isSettled) {
        rafId = requestAnimationFrame(loop);
      }
    }

    function startLoop() {
      if (isRunning || isSettled || isOffscreen || isTabHidden) return;
      isRunning = true;
      last = performance.now();
      rafId = requestAnimationFrame(loop);
    }

    function stopLoop() {
      isRunning = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    }

    // Visibility change pause
    document.addEventListener('visibilitychange', function () {
      isTabHidden = document.hidden;
      if (isTabHidden) {
        stopLoop();
      } else if (!isSettled) {
        startLoop();
      }
    });

    // Offscreen intersection pause
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          isOffscreen = !entry.isIntersecting;
          if (isOffscreen) {
            stopLoop();
          } else {
            if (!isSettled) {
              startLoop();
            } else {
              drawFrame(performance.now());
            }
          }
        });
      }, { threshold: 0.05 });
      observer.observe(stage);
    }

    // Start bloom or initial static frame
    if (mqReduced.matches) {
      isSettled = true;
      drawFrame(performance.now());
    } else {
      startLoop();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHeroLily);
  } else {
    initHeroLily();
  }
})();

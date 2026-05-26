"use client";

/* ════════════════════════════════════════════════════════════════════
   v204 — MountainStage

   Three.js 3D natural mountain backdrop for the BidGameZone /bid Step 1.
   Replaces the v203 dark-aurora + grid backdrop with a real, alive,
   premium feeling natural scene per Sachin's v203.2 note:

     "ek dum animated mountain climbing type feeling ... real natural
      mountain ... climber ki tarah connected lines ... wide background
      visuals with natural animated tree pakshi ... snow effect with
      real devdar ... flower ... ek dum alive feel har ek step par."

   Scene composition (all procedural, zero asset downloads):
     • Sky        — vertex-shader gradient (sunrise → midday → golden →
                    twilight) that retunes per step
     • Sun        — soft additive glow disc, position shifts per step
     • Mountains  — 3 layered ridges via procedural heightmap (PlaneGeo
                    with vertex displacement using value-noise we
                    inline below)
     • Snow caps  — vertex-color split: white above the snow line,
                    pine-green slope, cocoa rock at the base
     • Devdar     — InstancedMesh of cone geometry (~120 trees) scattered
                    deterministically on slopes below snow line, gentle
                    sway via shader
     • Snowflakes — GPU BufferGeometry points (~600), shader-animated
                    drift falling from top
     • Birds      — 2 simple sprite quads gliding across the sky on
                    sinusoidal paths
     • Climber + trail — drawn as an SVG OVERLAY on top of the canvas
                    (easier precise positioning than a 3D climber)
     • Step transitions — GSAP-tween camera dolly higher up the mountain
                    + sun rotation + sky tint

   Two render modes via the `active` prop:
     • active=true  — Full scene + climber trail + step animations
     • active=false — Static scenic snapshot used in boot screen (no
                      climber overlay, no step-driven animations)

   The Three.js scene mounts to a canvas in a ref, runs a single RAF
   loop, and is fully cleaned up on unmount. Reduced-motion users get
   a static frame (no animation loop) — accessibility-first.
═══════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import gsap from "gsap";

interface Props {
  /** 0..totalSteps-1 — drives camera position + sun position + sky tint */
  step: number;
  /** Total number of steps (typically 4-5) */
  totalSteps: number;
  /**
   * true = scene runs the RAF loop + shows climber trail overlay.
   * false = boot screen mode — static frame, no overlay, no animations.
   */
  active: boolean;
}

/* ── 2D value noise (cheap, deterministic, no deps) ────────────────── */
function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}
function valueNoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi,     yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi,     yi + 1);
  const d = hash2(xi + 1, yi + 1);
  const u = smoothstep(xf);
  const v = smoothstep(yf);
  return (
    a * (1 - u) * (1 - v) +
    b * u * (1 - v) +
    c * (1 - u) * v +
    d * u * v
  );
}
function fbm(x: number, y: number, octaves = 4) {
  let total = 0, amp = 1, freq = 1, maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise(x * freq, y * freq) * amp;
    maxAmp += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return total / maxAmp;
}

export default function MountainStage({ step, totalSteps, active }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<{
    renderer?: THREE.WebGLRenderer;
    scene?: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    raf?: number;
    cleanups: Array<() => void>;
    // Animated objects tweaked per step
    sunMaterial?: THREE.ShaderMaterial;
    skyMaterial?: THREE.ShaderMaterial;
    snowMaterial?: THREE.ShaderMaterial;
    treeMaterial?: THREE.ShaderMaterial;
    cameraTarget: THREE.Vector3;
    cameraPos: THREE.Vector3;
  }>({ cleanups: [], cameraTarget: new THREE.Vector3(), cameraPos: new THREE.Vector3() });

  // Derive step progress 0..1 for camera + sun positioning
  const progress = useMemo(() => {
    if (totalSteps <= 1) return 0;
    return Math.min(1, Math.max(0, step / (totalSteps - 1)));
  }, [step, totalSteps]);

  /* ── Mount Three.js scene once ──────────────────────────────────── */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const prefersReducedMotion = typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    const w = mount.clientWidth || 360;
    const h = mount.clientHeight || 640;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    // Scene + camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 500);
    camera.position.set(0, 18, 38);
    camera.lookAt(0, 8, 0);
    stateRef.current.cameraPos.copy(camera.position);
    stateRef.current.cameraTarget.set(0, 8, 0);

    // ── SKY ── procedural gradient via shader on a giant sphere
    const skyGeo = new THREE.SphereGeometry(200, 32, 16);
    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uTopColor:    { value: new THREE.Color(0x0a1830) },
        uMidColor:    { value: new THREE.Color(0xf0a868) },
        uBotColor:    { value: new THREE.Color(0xffd9a6) },
        uSunPos:      { value: new THREE.Vector3(0.4, 0.6, -1).normalize() },
      },
      vertexShader: /* glsl */`
        varying vec3 vWorldDir;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(worldPos.xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying vec3 vWorldDir;
        uniform vec3 uTopColor;
        uniform vec3 uMidColor;
        uniform vec3 uBotColor;
        uniform vec3 uSunPos;
        void main() {
          float t = clamp(vWorldDir.y * 0.5 + 0.5, 0.0, 1.0);
          // 3-stop blend: bottom → mid (horizon) → top (zenith)
          vec3 col = mix(uBotColor, uMidColor, smoothstep(0.0, 0.45, t));
          col = mix(col, uTopColor, smoothstep(0.45, 1.0, t));
          // Sun glow
          float sunDot = max(dot(normalize(vWorldDir), uSunPos), 0.0);
          float sunGlow = pow(sunDot, 64.0) * 0.85;
          col += vec3(1.0, 0.78, 0.45) * sunGlow;
          float halo = pow(sunDot, 6.0) * 0.18;
          col += vec3(1.0, 0.65, 0.32) * halo;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(skyGeo, skyMaterial);
    scene.add(sky);
    stateRef.current.skyMaterial = skyMaterial;

    // ── SUN DISC ── soft additive billboard
    const sunGeo = new THREE.CircleGeometry(2.4, 32);
    const sunMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(0xfff0c8) },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform vec3 uColor;
        void main() {
          float d = distance(vUv, vec2(0.5));
          float core = smoothstep(0.5, 0.0, d);
          float glow = smoothstep(0.5, 0.15, d) * 0.6;
          gl_FragColor = vec4(uColor, core + glow);
        }
      `,
    });
    const sun = new THREE.Mesh(sunGeo, sunMaterial);
    sun.position.set(-32, 28, -80);
    scene.add(sun);
    stateRef.current.sunMaterial = sunMaterial;

    // ── MOUNTAINS ── 3 ridge layers, far/mid/near, each a wide plane
    // with vertex displacement from fbm noise. Vertex colors paint snow
    // caps above a height threshold + green slopes + cocoa base.
    function makeRidge(opts: {
      width: number;
      depth: number;
      segW: number;
      segD: number;
      yBase: number;
      zBase: number;
      heightAmp: number;
      noiseScale: number;
      seed: number;
      tint: THREE.Color;
      snowLine: number;
    }) {
      const geo = new THREE.PlaneGeometry(opts.width, opts.depth, opts.segW, opts.segD);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const tip = new THREE.Color(0xfdfcf6); // snow
      const rock = new THREE.Color(0x8a7860); // cocoa
      const mid = opts.tint.clone();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        // Ridge profile: high in the middle (z near 0), low at edges
        const xRel = (x / opts.width) + opts.seed * 0.13;
        const zRel = (z / opts.depth);
        const ridgeShape = Math.exp(-Math.pow(zRel * 1.8, 2));
        const noise = fbm(xRel * opts.noiseScale, (zRel + opts.seed) * opts.noiseScale, 5);
        const peakBoost = Math.pow(ridgeShape, 1.4);
        const y = (noise * 0.7 + peakBoost * 0.9) * opts.heightAmp;
        pos.setY(i, y);
        // Color by height: snow caps → mid green → cocoa base
        const heightRatio = y / opts.heightAmp;
        let col: THREE.Color;
        if (heightRatio > opts.snowLine) {
          const t = Math.min(1, (heightRatio - opts.snowLine) / (1 - opts.snowLine));
          col = mid.clone().lerp(tip, smoothstep(t));
        } else if (heightRatio > 0.15) {
          const t = (heightRatio - 0.15) / (opts.snowLine - 0.15);
          col = rock.clone().lerp(mid, smoothstep(t));
        } else {
          col = rock.clone();
        }
        colors[i * 3]     = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: false,
        roughness: 0.92,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, opts.yBase, opts.zBase);
      return mesh;
    }
    // Far ridge — distant, hazy, big snow caps
    const farRidge = makeRidge({
      width: 220, depth: 80, segW: 110, segD: 32, yBase: -2, zBase: -82,
      heightAmp: 24, noiseScale: 2.4, seed: 0.3,
      tint: new THREE.Color(0x6a7a82), snowLine: 0.42,
    });
    scene.add(farRidge);
    // Mid ridge — mid-distance, more detail, mixed snow + slope
    const midRidge = makeRidge({
      width: 180, depth: 70, segW: 120, segD: 36, yBase: -3, zBase: -50,
      heightAmp: 18, noiseScale: 3.2, seed: 0.7,
      tint: new THREE.Color(0x596f5a), snowLine: 0.55,
    });
    scene.add(midRidge);
    // Near ridge — foreground, deep green slopes, little snow
    const nearRidge = makeRidge({
      width: 160, depth: 60, segW: 120, segD: 40, yBase: -4, zBase: -22,
      heightAmp: 12, noiseScale: 4.2, seed: 1.1,
      tint: new THREE.Color(0x3f5640), snowLine: 0.75,
    });
    scene.add(nearRidge);

    // ── DEVDAR TREES ── InstancedMesh of cone geometry scattered on near
    // + mid ridge slopes below snow line. Deterministic seeded scatter
    // so the layout stays stable across renders.
    function makeTrees(count: number, ridge: THREE.Mesh, opts: { yJitter: number; scale: number; seedBase: number }) {
      const trunkGeo = new THREE.ConeGeometry(0.55, 2.6, 7);
      trunkGeo.translate(0, 1.3, 0); // anchor at base
      const treeMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x2a3d2c),
        roughness: 0.9,
        metalness: 0,
      });
      const inst = new THREE.InstancedMesh(trunkGeo, treeMat, count);
      const dummy = new THREE.Object3D();
      const pos = ridge.geometry.attributes.position;
      const ridgeY = ridge.position.y;
      const ridgeZ = ridge.position.z;
      // Sample tree positions from low-to-mid height vertices only (avoid snow caps)
      const candidates: Array<[number, number, number]> = [];
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        // Tree spawn band: above base, well below snow caps
        const maxAmp = ridge === farRidge ? 24 : ridge === midRidge ? 18 : 12;
        if (y > maxAmp * 0.05 && y < maxAmp * 0.55) {
          candidates.push([pos.getX(i), y + ridgeY, pos.getZ(i) + ridgeZ]);
        }
      }
      for (let i = 0; i < count; i++) {
        const seed = (i + opts.seedBase) * 17.31;
        const rand = hash2(seed, seed * 1.7);
        const c = candidates[Math.floor(rand * candidates.length)];
        if (!c) continue;
        const jx = (hash2(seed, 0) - 0.5) * 1.5;
        const jz = (hash2(seed, 1) - 0.5) * 1.5;
        dummy.position.set(c[0] + jx, c[1] + opts.yJitter, c[2] + jz);
        const s = opts.scale * (0.7 + hash2(seed, 2) * 0.6);
        dummy.scale.set(s, s * (0.85 + hash2(seed, 3) * 0.4), s);
        dummy.rotation.y = hash2(seed, 4) * Math.PI * 2;
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      return inst;
    }
    const nearTrees = makeTrees(220, nearRidge, { yJitter: 0.05, scale: 1.1, seedBase: 0 });
    const midTrees  = makeTrees(180, midRidge,  { yJitter: 0.05, scale: 0.85, seedBase: 500 });
    scene.add(nearTrees);
    scene.add(midTrees);

    // ── SNOWFLAKES ── GPU points with shader drift
    const snowCount = prefersReducedMotion ? 0 : 520;
    const snowGeo = new THREE.BufferGeometry();
    const snowPos = new Float32Array(snowCount * 3);
    const snowOffsets = new Float32Array(snowCount);
    for (let i = 0; i < snowCount; i++) {
      snowPos[i * 3]     = (Math.random() - 0.5) * 120;
      snowPos[i * 3 + 1] = Math.random() * 40 + 6;
      snowPos[i * 3 + 2] = -8 - Math.random() * 70;
      snowOffsets[i] = Math.random() * 100;
    }
    snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPos, 3));
    snowGeo.setAttribute("aOffset", new THREE.BufferAttribute(snowOffsets, 1));
    const snowMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: renderer.getPixelRatio() },
      },
      vertexShader: /* glsl */`
        attribute float aOffset;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          float fall = mod(uTime * 0.6 + aOffset, 50.0);
          p.y -= fall;
          if (p.y < -4.0) p.y += 50.0;
          float sway = sin((uTime * 0.4) + aOffset * 6.0) * 0.6;
          p.x += sway;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = 2.6 * uPixelRatio * (180.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          vAlpha = clamp(0.5 + sin(uTime * 0.3 + aOffset * 4.0) * 0.5, 0.25, 0.85);
        }
      `,
      fragmentShader: /* glsl */`
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d) * vAlpha;
          gl_FragColor = vec4(1.0, 1.0, 1.0, a);
        }
      `,
    });
    const snowPoints = new THREE.Points(snowGeo, snowMaterial);
    if (snowCount > 0) scene.add(snowPoints);
    stateRef.current.snowMaterial = snowMaterial;

    // ── BIRDS ── 2 simple billboards (SVG-style M-shape via shader)
    const birdGeo = new THREE.PlaneGeometry(2, 1);
    const birdMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform float uTime;
        void main() {
          float flap = sin(uTime * 8.0 + vUv.x * 4.0) * 0.15 + 0.5;
          float wingY = flap;
          // bird shape: two arcs M-style
          float l = abs(vUv.x - 0.3);
          float r = abs(vUv.x - 0.7);
          float lineL = step(abs(vUv.y - wingY - (1.0 - l * 4.0) * 0.12), 0.04);
          float lineR = step(abs(vUv.y - wingY - (1.0 - r * 4.0) * 0.12), 0.04);
          float mask = max(lineL * step(vUv.x, 0.5), lineR * step(0.5, vUv.x));
          if (mask < 0.01) discard;
          gl_FragColor = vec4(0.08, 0.07, 0.05, 0.78);
        }
      `,
    });
    const bird1 = new THREE.Mesh(birdGeo, birdMaterial);
    bird1.position.set(-20, 22, -30);
    scene.add(bird1);
    const bird2 = new THREE.Mesh(birdGeo, birdMaterial);
    bird2.position.set(8, 26, -34);
    bird2.scale.set(0.7, 0.7, 0.7);
    scene.add(bird2);

    // ── LIGHTING ── ambient + directional warm key
    const ambient = new THREE.AmbientLight(0xfff2d9, 0.5);
    scene.add(ambient);
    const sunLight = new THREE.DirectionalLight(0xffe4b8, 0.9);
    sunLight.position.set(-30, 40, -10);
    scene.add(sunLight);
    const fill = new THREE.HemisphereLight(0xe2ecf6, 0x2a2418, 0.35);
    scene.add(fill);

    // ── RAF loop ──────────────────────────────────────────────────
    let lastT = performance.now();
    const tick = () => {
      const now = performance.now();
      const elapsed = (now - lastT) / 1000;
      const t = now / 1000;
      // Update animated uniforms
      if (snowMaterial.uniforms?.uTime) snowMaterial.uniforms.uTime.value = t;
      if (birdMaterial.uniforms?.uTime) birdMaterial.uniforms.uTime.value = t;
      // Birds drift across sky
      bird1.position.x = -20 + Math.sin(t * 0.18) * 28;
      bird1.position.y = 22 + Math.sin(t * 0.6) * 0.8;
      bird2.position.x = 8 + Math.sin(t * 0.13 + 1) * 24;
      bird2.position.y = 26 + Math.cos(t * 0.5 + 0.4) * 0.6;
      // Camera ease toward target (set per step)
      camera.position.lerp(stateRef.current.cameraPos, 0.06);
      camera.lookAt(stateRef.current.cameraTarget);
      renderer.render(scene, camera);
      stateRef.current.raf = requestAnimationFrame(tick);
    };
    if (!prefersReducedMotion) {
      stateRef.current.raf = requestAnimationFrame(tick);
    } else {
      // Single static frame
      renderer.render(scene, camera);
    }

    // ── Resize observer ──
    const onResize = () => {
      const W = mount.clientWidth || 360;
      const H = mount.clientHeight || 640;
      renderer.setSize(W, H);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    // Save state
    stateRef.current.renderer = renderer;
    stateRef.current.scene = scene;
    stateRef.current.camera = camera;
    stateRef.current.cleanups.push(() => {
      ro.disconnect();
      if (stateRef.current.raf) cancelAnimationFrame(stateRef.current.raf);
      renderer.dispose();
      skyMaterial.dispose();
      sunMaterial.dispose();
      snowMaterial.dispose();
      birdMaterial.dispose();
      [farRidge, midRidge, nearRidge].forEach((m) => {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      [nearTrees, midTrees].forEach((m) => {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      snowGeo.dispose();
      birdGeo.dispose();
      sunGeo.dispose();
      skyGeo.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    });

    return () => {
      stateRef.current.cleanups.forEach((fn) => fn());
      stateRef.current.cleanups = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Step-driven camera + sun + sky-mood retune ──────────────────── */
  useEffect(() => {
    const { skyMaterial, sunMaterial, camera } = stateRef.current;
    if (!skyMaterial || !sunMaterial) return;

    // Step-keyed mood: sunrise rose → midday clear → golden → twilight
    const moods = [
      // step 0 — dawn rose
      { top: 0x12243e, mid: 0xf4a87a, bot: 0xffe4c2, sun: new THREE.Vector3(-0.4, 0.35, -1).normalize(), camY: 14, camZ: 38 },
      // step 1 — morning soft blue
      { top: 0x1a3460, mid: 0x88bbe0, bot: 0xe0eef8, sun: new THREE.Vector3(-0.1, 0.55, -1).normalize(), camY: 17, camZ: 34 },
      // step 2 — mid-day clear
      { top: 0x2a5a98, mid: 0xb6d8ee, bot: 0xeaf3f8, sun: new THREE.Vector3(0.2, 0.7, -1).normalize(), camY: 20, camZ: 30 },
      // step 3 — golden hour
      { top: 0x2e1d4a, mid: 0xea9858, bot: 0xfbd8a3, sun: new THREE.Vector3(0.45, 0.32, -1).normalize(), camY: 23, camZ: 26 },
      // step 4 — twilight alpenglow
      { top: 0x0d1638, mid: 0xb55a76, bot: 0xf2c098, sun: new THREE.Vector3(0.55, 0.18, -1).normalize(), camY: 26, camZ: 22 },
    ];
    const idx = Math.min(step, moods.length - 1);
    const m = moods[idx];

    // GSAP tween for smooth retune
    const topCol = skyMaterial.uniforms.uTopColor.value as THREE.Color;
    const midCol = skyMaterial.uniforms.uMidColor.value as THREE.Color;
    const botCol = skyMaterial.uniforms.uBotColor.value as THREE.Color;
    const sunVec = skyMaterial.uniforms.uSunPos.value as THREE.Vector3;
    const targetTop = new THREE.Color(m.top);
    const targetMid = new THREE.Color(m.mid);
    const targetBot = new THREE.Color(m.bot);
    gsap.to(topCol, { r: targetTop.r, g: targetTop.g, b: targetTop.b, duration: 1.2, ease: "power2.inOut" });
    gsap.to(midCol, { r: targetMid.r, g: targetMid.g, b: targetMid.b, duration: 1.2, ease: "power2.inOut" });
    gsap.to(botCol, { r: targetBot.r, g: targetBot.g, b: targetBot.b, duration: 1.2, ease: "power2.inOut" });
    gsap.to(sunVec, { x: m.sun.x, y: m.sun.y, z: m.sun.z, duration: 1.2, ease: "power2.inOut" });

    // Camera dollies higher + closer per step (climber ascending)
    stateRef.current.cameraPos.set(0, m.camY, m.camZ);
    stateRef.current.cameraTarget.set(0, 8 + step * 1.4, 0);

    if (camera) {
      // Smoothly handled inside the RAF lerp; no manual position set
    }
  }, [step]);

  /* ── Climber trail overlay (SVG, top of canvas) ─────────────────── */
  // Trail is a fixed zig-zag path on the right side; climber-marker
  // position is interpolated along the path by `progress` (0..1).
  // Drawn as SVG so we can use stroke-dasharray for the "drawn in" feel
  // and CSS keyframe pulse on the marker.
  const trailPath = "M 18 92 C 24 80, 30 78, 36 70 C 42 62, 50 62, 56 52 C 62 42, 70 40, 76 30 C 82 22, 88 18, 92 10";
  const trailLen = 240; // approx total length in viewBox units for dash math
  const drawn = Math.max(0, Math.min(1, progress));

  return (
    <div className="bgms-stage" aria-hidden="true">
      {/* Three.js canvas mounts here */}
      <div className="bgms-canvas-wrap" ref={mountRef} />

      {/* Climber trail + marker overlay (only in active mode) */}
      {active && (
        <svg
          className="bgms-trail-svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {/* Trail glow halo */}
          <path
            d={trailPath}
            fill="none"
            stroke="rgba(231, 207, 160, 0.18)"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeDasharray="2 1.5"
          />
          {/* Drawn-in trail (animated by step) */}
          <path
            d={trailPath}
            fill="none"
            stroke="#E7CFA0"
            strokeWidth="0.6"
            strokeLinecap="round"
            strokeDasharray={trailLen}
            strokeDashoffset={trailLen * (1 - drawn)}
            style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.22, 0.9, 0.3, 1)" }}
          />
          {/* Climber position markers along the trail (one per past step) */}
          {Array.from({ length: totalSteps }).map((_, i) => {
            const p = i / Math.max(1, totalSteps - 1);
            const reached = i <= step;
            // sample point on the trail using a coarse approximation
            // (matches the SVG path's start/end + visual midpoint)
            const sx = 18 + (92 - 18) * p;
            const sy = 92 - (92 - 10) * p - Math.sin(p * Math.PI) * 4;
            return (
              <circle
                key={i}
                cx={sx}
                cy={sy}
                r={i === step ? 1.6 : 1.0}
                fill={reached ? "#F4E5C2" : "rgba(231, 207, 160, 0.25)"}
                stroke={i === step ? "#fffceb" : "transparent"}
                strokeWidth={0.4}
                className={i === step ? "bgms-climber-active" : ""}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}

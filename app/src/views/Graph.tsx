import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { api, type GraphData } from "../api";

// the constellation ... the keel as a living sky.
// time runs left to right (the keel's time axis), charge lifts a node,
// kind paints it. gpu-rendered; obsidian's 500-node ceiling does not live here.

const KIND_COLOR: Record<string, string> = {
  anchor: "#c9a86a",
  letter: "#8f7fc9",
  scar: "#d1665a",
  landmine: "#d1a13f",
  decision: "#6a9ec9",
  law: "#e8ddc0",
  note: "#6fbf73",
  phantom: "#4a4d55",
};

interface Laid {
  pos: Float32Array; // xyz per node
  sizes: Float32Array;
  colors: Float32Array;
  edgePos: Float32Array; // xyz pairs per edge
  nodes: GraphData["nodes"];
}

// tiny 3d force layout: seeded on a time axis, relaxed with springs + repulsion.
// ~700 nodes x 250 iterations ... nothing. obsidian's renderer could never.
function layout(data: GraphData): Laid {
  const n = data.nodes.length;
  const idx = new Map(data.nodes.map((nd, i) => [nd.id, i]));
  const pos = new Float32Array(n * 3);

  // seed: x by time (letters/anchors span the axis), y/z scattered by hash
  const times = data.nodes.map((nd) => Date.parse(nd.at || "") || 0);
  const tMin = Math.min(...times.filter((t) => t > 0), Date.now());
  const tMax = Math.max(...times, tMin + 1);
  const span = 220;
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  };
  for (let i = 0; i < n; i++) {
    const t = times[i] > 0 ? (times[i] - tMin) / (tMax - tMin) : hash(data.nodes[i].id);
    pos[i * 3] = (t - 0.5) * span;
    pos[i * 3 + 1] = (hash(data.nodes[i].id + "y") - 0.5) * 60;
    pos[i * 3 + 2] = (hash(data.nodes[i].id + "z") - 0.5) * 60;
  }

  // relax: spring on edges, repulsion on all pairs (spatial hash not needed at this scale)
  const edges = data.edges
    .map((e) => [idx.get(e.from), idx.get(e.to)] as const)
    .filter((p): p is readonly [number, number] => p[0] !== undefined && p[1] !== undefined);

  const REST = 14, REP = 900, DAMP = 0.85;
  const vel = new Float32Array(n * 3);
  for (let iter = 0; iter < 260; iter++) {
    const f = new Float32Array(n * 3);
    for (const [a, b] of edges) {
      const dx = pos[b * 3] - pos[a * 3], dy = pos[b * 3 + 1] - pos[a * 3 + 1], dz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const d = Math.max(0.1, Math.hypot(dx, dy, dz));
      const s = (d - REST) * 0.02;
      f[a * 3] += (dx / d) * s; f[a * 3 + 1] += (dy / d) * s; f[a * 3 + 2] += (dz / d) * s;
      f[b * 3] -= (dx / d) * s; f[b * 3 + 1] -= (dy / d) * s; f[b * 3 + 2] -= (dz / d) * s;
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[j * 3] - pos[i * 3], dy = pos[j * 3 + 1] - pos[i * 3 + 1], dz = pos[j * 3 + 2] - pos[i * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 3600 || d2 < 0.01) continue;
        const d = Math.sqrt(d2);
        const s = REP / (d2 * d) * 0.05;
        f[i * 3] -= dx * s; f[i * 3 + 1] -= dy * s; f[i * 3 + 2] -= dz * s;
        f[j * 3] += dx * s; f[j * 3 + 1] += dy * s; f[j * 3 + 2] += dz * s;
      }
    }
    // gentle pull back toward the time axis so the spine stays readable
    for (let i = 0; i < n; i++) {
      f[i * 3 + 1] -= pos[i * 3 + 1] * 0.0008;
      f[i * 3 + 2] -= pos[i * 3 + 2] * 0.0008;
      vel[i * 3] = (vel[i * 3] + f[i * 3]) * DAMP;
      vel[i * 3 + 1] = (vel[i * 3 + 1] + f[i * 3 + 1]) * DAMP;
      vel[i * 3 + 2] = (vel[i * 3 + 2] + f[i * 3 + 2]) * DAMP;
      pos[i * 3] += vel[i * 3];
      pos[i * 3 + 1] += vel[i * 3 + 1];
      pos[i * 3 + 2] += vel[i * 3 + 2];
    }
  }

  const sizes = new Float32Array(n);
  const colors = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const nd = data.nodes[i];
    sizes[i] = 0.9 + Math.min(3.2, (nd.charge ?? 1) * 0.55) + (nd.kind === "anchor" ? 1.2 : 0);
    c.set(KIND_COLOR[nd.kind] || "#8a877f");
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }

  const edgePos = new Float32Array(edges.length * 6);
  edges.forEach(([a, b], k) => {
    edgePos.set([pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], k * 6);
  });

  return { pos, sizes, colors, edgePos, nodes: data.nodes };
}

function Nodes({ laid, onHover }: { laid: Laid; onHover: (i: number | null) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { invalidate } = useThree();

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    for (let i = 0; i < laid.nodes.length; i++) {
      m.makeScale(laid.sizes[i], laid.sizes[i], laid.sizes[i]);
      m.setPosition(laid.pos[i * 3], laid.pos[i * 3 + 1], laid.pos[i * 3 + 2]);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [laid, invalidate]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, laid.nodes.length]}
      onPointerMove={(e) => { e.stopPropagation(); onHover(e.instanceId ?? null); }}
      onPointerOut={() => onHover(null)}
    >
      <sphereGeometry args={[1, 16, 16]}>
        <instancedBufferAttribute attach="attributes-color" args={[laid.colors, 3]} />
      </sphereGeometry>
      <meshBasicMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
}

function Edges({ laid }: { laid: Laid }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(laid.edgePos, 3));
    return g;
  }, [laid]);
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#3a3d4a" transparent opacity={0.35} />
    </lineSegments>
  );
}

export default function GraphView() {
  const [data, setData] = useState<GraphData | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.graph().then(setData).catch((e) => setErr(String(e.message || e)));
  }, []);

  const laid = useMemo(() => (data ? layout(data) : null), [data]);
  const hovered = laid && hover !== null ? laid.nodes[hover] : null;

  if (err) return <main className="main"><div className="panel">graph dark ... {err}</div></main>;
  if (!laid) return <main className="main"><p className="muted">gathering the constellation...</p></main>;

  return (
    <div className="graphwrap">
      <Canvas
        camera={{ position: [0, 30, 190], fov: 55 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
      >
        <ambientLight intensity={0.6} />
        <Nodes laid={laid} onHover={setHover} />
        <Edges laid={laid} />
        <EffectComposer>
          <Bloom intensity={0.9} luminanceThreshold={0.15} luminanceSmoothing={0.4} mipmapBlur />
        </EffectComposer>
        <OrbitControls enableDamping dampingFactor={0.08} />
      </Canvas>

      <div className="graphlegend">
        {Object.entries(KIND_COLOR).map(([k, c]) => (
          <span key={k}>
            <span style={{ color: c }}>&#9679;</span> {k}
          </span>
        ))}
        <span className="faint">{laid.nodes.length} nodes</span>
      </div>

      {hovered && (
        <div className="graphhud panel">
          <div className={`kind-${hovered.kind} small`} style={{ marginBottom: 6 }}>
            {hovered.kind} {hovered.lane ? `· ${hovered.lane}` : ""}
          </div>
          <div>{hovered.label}</div>
          {hovered.charge !== undefined && (
            <div className="faint small" style={{ marginTop: 6 }}>charge {hovered.charge.toFixed(2)}</div>
          )}
          {hovered.at && <div className="faint small">{hovered.at.slice(0, 19).replace("T", " ")}</div>}
        </div>
      )}
    </div>
  );
}

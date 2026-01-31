import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '../constants/colors';

type DiagramRendererProps = {
  mermaidCode: string;
  height?: number;
  style?: ViewStyle;
};

type GraphNode = {
  id: string;
  label: string;
};

type GraphEdge = {
  from: string;
  to: string;
  label?: string;
};

function parseMermaidFlowchart(code: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const text = String(code || '').trim();
  if (!text) return { nodes: [], edges: [] };

  // Mermaid often comes as either multi-line or single-line separated by ';'
  // Example: "graph TD; A[One]-->B[Two]; B-->C"
  const lines = text
    .split(/\r?\n/)
    .flatMap((l) => l.split(';'))
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('%%'));

  const nodesById = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const upsertNode = (idRaw: string, label?: string) => {
    const id = String(idRaw || '').trim();
    if (!id) return;
    const existing = nodesById.get(id);
    const nextLabel = (label ?? existing?.label ?? id).trim();
    nodesById.set(id, { id, label: nextLabel || id });
  };

  const parseNodeToken = (token: string): { id: string; label?: string } => {
    const t = token.trim();
    // A[Label], A("Label"), A((Label)), A{Label}
    const m = t.match(/^([A-Za-z0-9_\-:.]+)\s*(\[|\(|\{)\s*(.*)\s*(\]|\)|\})\s*$/);
    if (m) {
      const id = m[1];
      let label = (m[3] || '').trim();
      label = label.replace(/^"|"$/g, '').trim();
      // strip extra parens for ((Label)) and (( ))
      label = label.replace(/^\(+/, '').replace(/\)+$/, '').trim();
      return { id, label: label || id };
    }
    // plain id
    return { id: t };
  };

  const parseEdgeLine = (line: string) => {
    // Support common Mermaid flowchart patterns:
    // A-->B
    // A -- text --> B
    // A--> |text| B
    // A --- B
    // A --> B

    if (/^graph\s+/i.test(line) || /^flowchart\s+/i.test(line)) return;
    if (/^subgraph\b/i.test(line) || /^end\b/i.test(line)) return;

    // Strip trailing semicolons (after split, but just in case)
    const cleaned = line.replace(/;+\s*$/, '').trim();

    // Normalize whitespace
    const normalized = cleaned.replace(/\s+/g, ' ');

    // Try to capture a left token, an arrow, optional label, right token
    const m = normalized.match(/^(.+?)\s*(-->|---|->|==>|=>|--\s+.*\s+-->)\s*(.+)$/);
    if (!m) return;

    const left = m[1].trim();
    const arrowAndMaybeLabel = m[2].trim();
    const right = m[3].trim();

    // Extract label formats: -- text -->, -->|text|, etc.
    let edgeLabel: string | undefined;
    const labelMatchPipe = arrowAndMaybeLabel.match(/\|(.+?)\|/);
    if (labelMatchPipe) {
      edgeLabel = labelMatchPipe[1].trim();
    } else {
      const labelMatchText = arrowAndMaybeLabel.match(/^--\s+(.+?)\s+-->$/);
      if (labelMatchText) edgeLabel = labelMatchText[1].trim();
    }

    const leftToken = parseNodeToken(left);
    const rightToken = parseNodeToken(right);

    upsertNode(leftToken.id, leftToken.label);
    upsertNode(rightToken.id, rightToken.label);

    edges.push({ from: leftToken.id, to: rightToken.id, label: edgeLabel });
  };

  for (const line of lines) {
    // Node-only declarations like A[Label]
    if (/^[A-Za-z0-9_\-:.]+\s*(\[|\(|\{)/.test(line) && !/-->|---|->|=>|==>/.test(line)) {
      const tok = parseNodeToken(line);
      upsertNode(tok.id, tok.label);
      continue;
    }

    parseEdgeLine(line);
  }

  return { nodes: Array.from(nodesById.values()), edges };
}

function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]) {
  const nodeWidth = 160;
  const nodeHeight = 52;
  const gapX = 56;
  const gapY = 24;
  const padding = 24;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, string[]>();
  const indeg = new Map<string, number>();

  for (const n of nodes) {
    outgoing.set(n.id, []);
    indeg.set(n.id, 0);
  }

  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    outgoing.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
  }

  // Topological-ish levels (works best for DAGs; falls back gracefully)
  const queue: string[] = [];
  for (const [id, d] of indeg.entries()) {
    if (d === 0) queue.push(id);
  }

  const level = new Map<string, number>();
  for (const id of queue) level.set(id, 0);

  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    visited.add(id);
    const curLevel = level.get(id) || 0;
    for (const to of outgoing.get(id) || []) {
      const nextLevel = Math.max(level.get(to) || 0, curLevel + 1);
      level.set(to, nextLevel);
      indeg.set(to, (indeg.get(to) || 0) - 1);
      if ((indeg.get(to) || 0) <= 0 && !visited.has(to)) {
        queue.push(to);
      }
    }
  }

  // Any remaining nodes (cycles/unreachable) get appended
  let maxLevel = 0;
  for (const n of nodes) {
    if (!level.has(n.id)) level.set(n.id, 0);
    maxLevel = Math.max(maxLevel, level.get(n.id) || 0);
  }

  const columns = new Map<number, string[]>();
  for (const n of nodes) {
    const l = level.get(n.id) || 0;
    if (!columns.has(l)) columns.set(l, []);
    columns.get(l)!.push(n.id);
  }

  // Keep stable ordering per column
  for (const ids of columns.values()) ids.sort();

  const positions = new Map<string, { x: number; y: number }>();
  for (const [l, ids] of columns.entries()) {
    ids.forEach((id, idx) => {
      const x = padding + l * (nodeWidth + gapX);
      const y = padding + idx * (nodeHeight + gapY);
      positions.set(id, { x, y });
    });
  }

  const maxColSize = Math.max(1, ...Array.from(columns.values()).map((v) => v.length));
  const width = padding * 2 + (maxLevel + 1) * nodeWidth + maxLevel * gapX;
  const height = padding * 2 + maxColSize * nodeHeight + Math.max(0, maxColSize - 1) * gapY;

  return { positions, width, height, nodeWidth, nodeHeight, padding };
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildSvg(nodes: GraphNode[], edges: GraphEdge[]) {
  const { positions, width, height, nodeWidth, nodeHeight } = layoutGraph(nodes, edges);

  const nodeFill = colors.cardBackground;
  const nodeStroke = colors.primary;
  const edgeStroke = colors.textSecondary;
  const textColor = colors.text;

  const markerId = 'arrow';

  const edgeEls = edges
    .map((e, idx) => {
      const from = positions.get(e.from);
      const to = positions.get(e.to);
      if (!from || !to) return '';

      const x1 = from.x + nodeWidth;
      const y1 = from.y + nodeHeight / 2;
      const x2 = to.x;
      const y2 = to.y + nodeHeight / 2;

      const midX = (x1 + x2) / 2;
      const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

      const label = (e.label || '').trim();
      const labelEl = label
        ? `<text x="${midX}" y="${(y1 + y2) / 2 - 6}" font-size="11" text-anchor="middle" fill="${edgeStroke}">${escapeHtml(label)}</text>`
        : '';

      return `
        <path d="${d}" fill="none" stroke="${edgeStroke}" stroke-width="2" marker-end="url(#${markerId})" />
        ${labelEl}
      `;
    })
    .join('\n');

  const nodeEls = nodes
    .map((n) => {
      const p = positions.get(n.id);
      if (!p) return '';
      const cx = p.x + nodeWidth / 2;
      const cy = p.y + nodeHeight / 2;
      const label = (n.label || n.id).trim();

      // Basic 2-line wrap
      const words = label.split(/\s+/).filter(Boolean);
      const line1: string[] = [];
      const line2: string[] = [];
      let cur = line1;
      for (const w of words) {
        const target = cur.join(' ');
        if ((target + ' ' + w).trim().length > 18 && cur === line1) {
          cur = line2;
        }
        if (cur.join(' ').length < 22) cur.push(w);
      }

      const t1 = escapeHtml(line1.join(' ') || label);
      const t2 = escapeHtml(line2.join(' '));

      const text = t2
        ? `<text x="${cx}" y="${cy - 4}" font-size="12" text-anchor="middle" fill="${textColor}">
             <tspan x="${cx}" dy="0">${t1}</tspan>
             <tspan x="${cx}" dy="14">${t2}</tspan>
           </text>`
        : `<text x="${cx}" y="${cy + 4}" font-size="12" text-anchor="middle" fill="${textColor}">${t1}</text>`;

      return `
        <g>
          <rect x="${p.x}" y="${p.y}" width="${nodeWidth}" height="${nodeHeight}" rx="10" ry="10" fill="${nodeFill}" stroke="${nodeStroke}" stroke-width="2" />
          ${text}
        </g>
      `;
    })
    .join('\n');

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <marker id="${markerId}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="${edgeStroke}" />
      </marker>
    </defs>
    <rect x="0" y="0" width="100%" height="100%" fill="${colors.background}" />
    ${edgeEls}
    ${nodeEls}
  </svg>`;
}

export default function DiagramRenderer({ mermaidCode, height = 260, style }: DiagramRendererProps) {
  const parsed = useMemo(() => parseMermaidFlowchart(mermaidCode), [mermaidCode]);

  const html = useMemo(() => {
    const hasGraph = parsed.nodes.length >= 2 && parsed.edges.length >= 1;
    if (!hasGraph) return null;

    const svg = buildSvg(parsed.nodes, parsed.edges);

    return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      html, body { margin: 0; padding: 0; background: ${colors.background}; }
      .wrap { width: 100%; height: 100%; overflow: auto; }
      svg { display: block; }
    </style>
  </head>
  <body>
    <div class="wrap">${svg}</div>
  </body>
</html>`;
  }, [parsed]);

  if (!mermaidCode || mermaidCode.trim().length === 0) return null;

  if (!html) {
    // Fallback: show the diagram as code (current behavior), but clearly.
    return (
      <View style={[styles.fallback, style]}>
        <Text style={styles.fallbackTitle}>Diagram</Text>
        <Text style={styles.code} numberOfLines={10}>{mermaidCode.trim()}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }, style]}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        javaScriptEnabled={false}
        domStorageEnabled={false}
        scrollEnabled
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  webview: {
    backgroundColor: colors.background,
  },
  fallback: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: colors.cardBackground,
  },
  fallbackTitle: {
    color: colors.text,
    fontWeight: '600',
    marginBottom: 8,
  },
  code: {
    color: colors.textSecondary,
    fontFamily: 'Menlo',
    fontSize: 12,
  },
});

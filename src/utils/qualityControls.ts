export type VendorCandidate = {
  name: string;
  confidence?: number;
};

export function shouldShowSingleVendorLabel(vendorConfidence: number | null | undefined): boolean {
  const c = typeof vendorConfidence === 'number' ? vendorConfidence : 0;
  return c >= 0.85;
}

export function buildCoverageWarning(params: {
  coverageRatio: number | null | undefined;
  missingPages?: number[];
}): { warning: string | null; missingPages: number[] } {
  // Unknown coverage should not show a scary 0% warning.
  if (params.coverageRatio == null) {
    return { warning: null, missingPages: Array.isArray(params.missingPages) ? params.missingPages : [] };
  }

  const ratio = Number(params.coverageRatio);
  const missingPages = Array.isArray(params.missingPages) ? params.missingPages : [];

  if (!Number.isFinite(ratio) || ratio >= 0.95) {
    return { warning: null, missingPages };
  }

  const pct = Math.round(ratio * 100);
  const warning =
    `⚠️ Extraction coverage is ${pct}%. ` +
    `Classification and Deep Explain may be incomplete and must not claim completeness.`;

  return { warning, missingPages };
}

type CoverageMeta = {
  coverage?: {
    ratio?: number | null;
    warning?: string | null;
    missingPages?: number[];
  };
};

export function enforceCoverageOnOutput<T extends Record<string, any>>(
  output: T,
  params: { coverageRatio: number | null | undefined; missingPages?: number[] }
): T & CoverageMeta {
  const { warning, missingPages } = buildCoverageWarning({
    coverageRatio: params.coverageRatio,
    missingPages: params.missingPages,
  });

  const next = { ...output } as T & CoverageMeta;
  next.coverage = {
    ...(next.coverage || {}),
    ratio: params.coverageRatio,
    warning: warning ?? (next.coverage?.warning ?? null),
    missingPages: Array.isArray(next.coverage?.missingPages)
      ? next.coverage.missingPages
      : missingPages,
  };

  return next;
}

export function buildVendorDisplay(params: {
  vendorName?: string | null;
  vendorConfidence?: number | null;
  candidates?: VendorCandidate[];
}): { title: string; subtitle: string | null; showSingle: boolean } {
  const vendorName = (params.vendorName || '').trim();
  const showSingle = shouldShowSingleVendorLabel(params.vendorConfidence);

  const candidates = (Array.isArray(params.candidates) ? params.candidates : [])
    .map((c) => ({
      name: String(c?.name || '').trim(),
      confidence: typeof c?.confidence === 'number' ? c.confidence : undefined,
    }))
    .filter((c) => c.name.length > 0)
    .slice(0, 3);

  if (showSingle && vendorName) {
    return { title: vendorName, subtitle: null, showSingle: true };
  }

  // Low confidence: show possible vendors list.
  const names = candidates.map((c) => c.name);
  if (names.length === 0 && vendorName) names.push(vendorName);

  const subtitle = names.length > 0 ? names.join(' • ') : null;

  return {
    title: 'Possible vendors',
    subtitle,
    showSingle: false,
  };
}

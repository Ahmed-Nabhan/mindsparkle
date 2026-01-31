import { describe, expect, it } from 'vitest';
import {
  buildCoverageWarning,
  shouldShowSingleVendorLabel,
  buildVendorDisplay,
  enforceCoverageOnOutput,
} from './qualityControls';

describe('qualityControls', () => {
  it('adds warning when coverage < 0.95', () => {
    const res = buildCoverageWarning({ coverageRatio: 0.7, missingPages: [2, 4] });
    expect(res.warning).toContain('Extraction coverage');
    expect(res.missingPages).toEqual([2, 4]);
  });

  it('has no warning when coverage >= 0.95', () => {
    const res = buildCoverageWarning({ coverageRatio: 0.95, missingPages: [] });
    expect(res.warning).toBeNull();
  });

  it('has no warning when coverage is unknown', () => {
    const res = buildCoverageWarning({ coverageRatio: null, missingPages: [1, 2] });
    expect(res.warning).toBeNull();
    expect(res.missingPages).toEqual([1, 2]);
  });

  it('gates single vendor label at 0.85', () => {
    expect(shouldShowSingleVendorLabel(0.849)).toBe(false);
    expect(shouldShowSingleVendorLabel(0.85)).toBe(true);
  });

  it('shows possible vendors when vendor confidence is low', () => {
    const d = buildVendorDisplay({
      vendorName: 'Cisco',
      vendorConfidence: 0.6,
      candidates: [{ name: 'Cisco' }, { name: 'Juniper' }],
    });

    expect(d.title).toBe('Possible vendors');
    expect(d.subtitle).toContain('Cisco');
  });

  it('enforces coverage fields onto an output object', () => {
    const out = enforceCoverageOnOutput(
      { outputType: 'deep_explain' },
      { coverageRatio: 0.5, missingPages: [1] }
    );

    expect(out.coverage).toBeDefined();
    if (!out.coverage) throw new Error('Expected coverage to be defined');

    expect(out.coverage.ratio).toBe(0.5);
    expect(out.coverage.warning).toContain('must not claim completeness');
    expect(out.coverage.missingPages).toEqual([1]);
  });
});

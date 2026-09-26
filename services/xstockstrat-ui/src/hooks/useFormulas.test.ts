import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FundamentalMetric } from '@xstockstrat/proto/indicators/v1/indicators_pb';

// Node-env unit test (no jsdom): mock react-query so the hook bodies run as plain functions and we
// capture the mutationFn each one hands to useMutation, then invoke it and assert the RPC payload.
// vi.hoisted lets the mock state exist before the hoisted vi.mock factories reference it.
const h = vi.hoisted(() => ({
  registerFormula: vi.fn().mockResolvedValue({ formulaId: 'f1' }),
  updateFormula: vi.fn().mockResolvedValue({}),
  captured: undefined as ((vars: Record<string, unknown>) => unknown) | undefined,
}));

vi.mock('@/lib/browserClients/indicatorsClient', () => ({
  indicatorsClient: { registerFormula: h.registerFormula, updateFormula: h.updateFormula },
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: (opts: { mutationFn: (vars: Record<string, unknown>) => unknown }) => {
    h.captured = opts.mutationFn;
    return {};
  },
  useQuery: () => ({}),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { useRegisterFormula, useUpdateFormula } from './useFormulas';

describe('useFormulas — fundamentalInputs threading (feature 205)', () => {
  beforeEach(() => {
    h.registerFormula.mockClear();
    h.updateFormula.mockClear();
    h.captured = undefined;
  });

  it('useRegisterFormula forwards fundamentalInputs into the RegisterFormula payload', async () => {
    useRegisterFormula();
    await h.captured!({ name: 'v', fundamentalInputs: [FundamentalMetric.PE_RATIO] });
    expect(h.registerFormula).toHaveBeenCalledWith(
      expect.objectContaining({ fundamentalInputs: [FundamentalMetric.PE_RATIO] }),
    );
  });

  it('useRegisterFormula defaults fundamentalInputs to [] when the caller omits it', async () => {
    useRegisterFormula();
    await h.captured!({ name: 'v' });
    expect(h.registerFormula).toHaveBeenCalledWith(
      expect.objectContaining({ fundamentalInputs: [] }),
    );
  });

  it('useUpdateFormula forwards fundamentalInputs into the UpdateFormula payload', async () => {
    useUpdateFormula();
    await h.captured!({ formulaId: 'f1', fundamentalInputs: [FundamentalMetric.ROE] });
    expect(h.updateFormula).toHaveBeenCalledWith(
      expect.objectContaining({ fundamentalInputs: [FundamentalMetric.ROE] }),
    );
  });

  it('useUpdateFormula defaults fundamentalInputs to [] when the caller omits it', async () => {
    useUpdateFormula();
    await h.captured!({ formulaId: 'f1' });
    expect(h.updateFormula).toHaveBeenCalledWith(
      expect.objectContaining({ fundamentalInputs: [] }),
    );
  });
});

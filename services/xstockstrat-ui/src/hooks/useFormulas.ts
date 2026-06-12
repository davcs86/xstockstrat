import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ListFormulasRequest } from '@xstockstrat/proto/indicators/v1/indicators_pb';
import type { FormulaParameterInit } from '@/components/insights/ParameterEditor';
import type { FormulaOutputInit } from '@/components/insights/OutputEditor';
import { indicatorsClient } from '@/lib/browserClients/indicatorsClient';

export function useFormulas(params: Partial<ListFormulasRequest> = {}) {
  return useQuery({
    queryKey: ['indicators-formulas', params],
    queryFn: () =>
      indicatorsClient.listFormulas({
        authorFilter: params.authorFilter ?? '',
        includePublic: params.includePublic ?? true,
        pageSize: params.pageSize ?? 50,
        pageOffset: params.pageOffset ?? 0,
      }),
  });
}

export function useFormula(formulaId: string | undefined) {
  return useQuery({
    queryKey: ['indicators-formula', formulaId],
    queryFn: () => indicatorsClient.getFormula({ formulaId: formulaId! }),
    enabled: !!formulaId,
  });
}

export function useRegisterFormula() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: {
      name?: string;
      description?: string;
      source?: string;
      isPublic?: boolean;
      inputSchema?: Record<string, string>;
      author?: string;
      parameters?: FormulaParameterInit[];
      outputs?: FormulaOutputInit[];
    }) =>
      indicatorsClient.registerFormula({
        name: req.name ?? '',
        description: req.description ?? '',
        source: req.source ?? '',
        isPublic: req.isPublic ?? false,
        inputSchema: req.inputSchema ?? {},
        author: req.author ?? '',
        parameters: req.parameters ?? [],
        outputs: req.outputs ?? [],
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['indicators-formulas'] }),
  });
}

export function useUpdateFormula() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: {
      formulaId: string;
      userId?: string;
      name?: string;
      description?: string;
      source?: string;
      isPublic?: boolean;
      parameters?: FormulaParameterInit[];
      outputs?: FormulaOutputInit[];
    }) =>
      indicatorsClient.updateFormula({
        formulaId: req.formulaId,
        userId: req.userId ?? '',
        name: req.name ?? '',
        description: req.description ?? '',
        source: req.source ?? '',
        isPublic: req.isPublic ?? false,
        parameters: req.parameters ?? [],
        outputs: req.outputs ?? [],
      }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['indicators-formulas'] });
      queryClient.invalidateQueries({ queryKey: ['indicators-formula', vars.formulaId] });
    },
  });
}

export function useDeleteFormula() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: { formulaId: string; userId: string }) => indicatorsClient.deleteFormula(req),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['indicators-formulas'] }),
  });
}

export function useExecuteFormula() {
  return useMutation({
    // Either formulaId (run a saved formula) or formulaSource (run the current,
    // possibly unsaved, editor buffer — the notebook-style "Run" behavior).
    // For inline formula_source runs, `parameters` carries the in-editor parameter
    // DEFINITIONS so the engine can validate input_params and apply defaults
    // (saved formulas use their stored definitions and ignore this).
    mutationFn: (req: {
      formulaId?: string;
      formulaSource?: string;
      inputData: Record<string, unknown>;
      inputParams?: Record<string, unknown>;
      parameters?: FormulaParameterInit[];
    }) =>
      indicatorsClient.executeFormula({
        formulaId: req.formulaId ?? '',
        formulaSource: req.formulaSource ?? '',
        inputData: req.inputData as Record<string, never>,
        inputParams: (req.inputParams ?? {}) as Record<string, never>,
        parameters: req.parameters ?? [],
      }),
  });
}

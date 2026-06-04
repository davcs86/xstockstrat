import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ListFormulasRequest,
  RegisterFormulaRequest,
  UpdateFormulaRequest,
} from '@xstockstrat/proto/indicators/v1/indicators_pb';
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
    mutationFn: (req: Partial<RegisterFormulaRequest>) =>
      indicatorsClient.registerFormula({
        name: req.name ?? '',
        description: req.description ?? '',
        source: req.source ?? '',
        isPublic: req.isPublic ?? false,
        inputSchema: req.inputSchema ?? {},
        author: req.author ?? '',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['indicators-formulas'] }),
  });
}

export function useUpdateFormula() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: Partial<UpdateFormulaRequest> & { formulaId: string }) =>
      indicatorsClient.updateFormula({
        formulaId: req.formulaId,
        userId: req.userId ?? '',
        name: req.name ?? '',
        description: req.description ?? '',
        source: req.source ?? '',
        isPublic: req.isPublic ?? false,
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
    mutationFn: (req: { formulaId: string; userId: string }) =>
      indicatorsClient.deleteFormula(req),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['indicators-formulas'] }),
  });
}

export function useExecuteFormula() {
  return useMutation({
    mutationFn: (req: { formulaId: string; inputData: Record<string, unknown> }) =>
      indicatorsClient.executeFormula({
        formulaId: req.formulaId,
        inputData: req.inputData as Record<string, never>,
      }),
  });
}

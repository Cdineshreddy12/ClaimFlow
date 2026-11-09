import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CustomFieldInput,
  CustomModule,
  CustomModuleInput,
  CustomRecord,
} from "@claimflow/contracts";
import { api } from "@/lib/api-client";

/** The nav reads this, so it only ever asks for live modules. */
export function useCustomModules(includeInactive = false) {
  return useQuery({
    queryKey: ["custom-modules", { includeInactive }],
    queryFn: () =>
      api.get<CustomModule[]>(
        `/custom-modules${includeInactive ? "?includeInactive=true" : ""}`,
      ),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCustomModule(slug: string) {
  return useQuery({
    queryKey: ["custom-modules", slug],
    queryFn: () => api.get<CustomModule>(`/custom-modules/${slug}`),
    enabled: Boolean(slug),
  });
}

export function useCustomRecords(slug: string) {
  return useQuery({
    queryKey: ["custom-modules", slug, "records"],
    queryFn: () =>
      api.get<{ module: CustomModule; records: CustomRecord[] }>(
        `/custom-modules/${slug}/records`,
      ),
    enabled: Boolean(slug),
  });
}

/**
 * Every write here invalidates the whole tree.
 *
 * Deliberately not returned from `onSuccess`: react-query holds a
 * mutation pending until a promise handed back from there settles, and
 * a button that waits on refetches nobody is watching reads as broken.
 */
function useModuleMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["custom-modules"] });
    },
  });
}

export function useCreateModule() {
  return useModuleMutation((body: CustomModuleInput) =>
    api.post<CustomModule>("/custom-modules", body),
  );
}

export function useUpdateModule() {
  return useModuleMutation(
    ({ id, ...body }: CustomModuleInput & { id: string }) =>
      api.patch<CustomModule>(`/custom-modules/${id}`, body),
  );
}

export function useSetModuleActive() {
  return useModuleMutation(
    ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch<CustomModule>(`/custom-modules/${id}/active`, { isActive }),
  );
}

export function useDeleteModule() {
  return useModuleMutation((id: string) => api.delete(`/custom-modules/${id}`));
}

export function useAddField(slug: string) {
  return useModuleMutation((body: CustomFieldInput) =>
    api.post(`/custom-modules/${slug}/fields`, body),
  );
}

export function useRemoveField(slug: string) {
  return useModuleMutation((fieldId: string) =>
    api.delete(`/custom-modules/${slug}/fields/${fieldId}`),
  );
}

export function useCreateRecord(slug: string) {
  return useModuleMutation((data: Record<string, string>) =>
    api.post<CustomRecord>(`/custom-modules/${slug}/records`, { data }),
  );
}

export function useUpdateRecord(slug: string) {
  return useModuleMutation(
    ({ id, data }: { id: string; data: Record<string, string> }) =>
      api.patch<CustomRecord>(`/custom-modules/${slug}/records/${id}`, {
        data,
      }),
  );
}

export function useDeleteRecord(slug: string) {
  return useModuleMutation((id: string) =>
    api.delete(`/custom-modules/${slug}/records/${id}`),
  );
}

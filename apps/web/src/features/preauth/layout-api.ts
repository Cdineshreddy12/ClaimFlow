import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PreauthLayout, PreauthPlacement } from "@claimflow/contracts";
import { api } from "../../lib/api-client";

export interface FieldDefinitionRow {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  hint: string | null;
  options: { value: string; label: string }[] | null;
  isStandard: boolean;
}

/** The live, editable layout — what the builder works on. */
export function usePreauthLayout(insurerId?: string) {
  return useQuery({
    queryKey: ["preauth-layout", insurerId ?? "default"],
    queryFn: () =>
      api.get<PreauthLayout>(
        `/preauth-layout${insurerId ? `?insurerId=${insurerId}` : ""}`,
      ),
  });
}

/**
 * The layout a claim was opened under — its frozen snapshot.
 *
 * Deliberately a different query from the one above. The claim screen
 * must never render the live layout, or editing the form would change
 * what an in-flight claim appears to have asked for.
 */
export function useClaimLayout(claimId: string) {
  return useQuery({
    queryKey: ["claims", claimId, "preauth-layout"],
    queryFn: () =>
      api.get<PreauthLayout>(`/claims/${claimId}/preauth-fields/layout`),
    enabled: Boolean(claimId),
  });
}

export function useFieldDefinitions() {
  return useQuery({
    queryKey: ["preauth-layout", "fields"],
    queryFn: () => api.get<FieldDefinitionRow[]>("/preauth-layout/fields"),
  });
}

function useLayoutMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["preauth-layout"] }),
  });
}

/**
 * Same as useLayoutMutation, but paints the drag's result into the
 * cache before the request resolves.
 *
 * Without this, a drag that completes instantly on screen (dnd-kit
 * drops the row right where it was released) sat there unmoved until
 * the round trip to the API finished and refetched — the drop looked
 * like it had failed for however long that took, which is the thing
 * being fixed here, not just a loading spinner's worth of patience.
 *
 * Rolls back on error via the snapshot every `preauth-layout` query had
 * before `update` ran, and always refetches on settle so the
 * server's order — the actual source of truth — wins once it arrives.
 */
function useOptimisticLayoutMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  update: (layout: PreauthLayout, args: TArgs) => PreauthLayout,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onMutate: async (args: TArgs) => {
      await queryClient.cancelQueries({ queryKey: ["preauth-layout"] });
      const snapshot = queryClient.getQueriesData<PreauthLayout>({
        queryKey: ["preauth-layout"],
      });
      queryClient.setQueriesData<PreauthLayout | undefined>(
        { queryKey: ["preauth-layout"] },
        (layout) => (layout?.sections ? update(layout, args) : layout),
      );
      return { snapshot };
    },
    onError: (_err, _args, context) => {
      context?.snapshot.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["preauth-layout"] }),
  });
}

/** Every placement in the layout, wherever it currently sits. */
function findPlacementAnywhere(
  layout: PreauthLayout,
  id: string,
): PreauthPlacement | undefined {
  for (const section of layout.sections) {
    const placement = section.placements.find((p) => p.id === id);
    if (placement) return placement;
  }
  return undefined;
}

export function useCreateField() {
  return useLayoutMutation(
    (body: {
      fieldKey: string;
      label: string;
      fieldType: string;
      hint?: string | null;
      options?: { value: string; label: string }[] | null;
    }) => api.post<FieldDefinitionRow>("/preauth-layout/fields", body),
  );
}

export function useDeleteField() {
  return useLayoutMutation((id: string) =>
    api.delete(`/preauth-layout/fields/${id}`),
  );
}

export function useAddSection() {
  return useLayoutMutation(
    (body: { layoutId: string; name: string; displayOrder: number }) =>
      api.post("/preauth-layout/sections", body),
  );
}

export function useRenameSection() {
  return useLayoutMutation(({ id, name }: { id: string; name: string }) =>
    api.patch(`/preauth-layout/sections/${id}`, { name }),
  );
}

export function useDeleteSection() {
  return useLayoutMutation((id: string) =>
    api.delete(`/preauth-layout/sections/${id}`),
  );
}

export function useAddPlacement() {
  return useLayoutMutation(
    (body: {
      sectionId: string;
      fieldDefinitionId: string;
      displayOrder: number;
      columnPosition?: number;
    }) => api.post("/preauth-layout/placements", body),
  );
}

export function useUpdatePlacement() {
  return useLayoutMutation(
    ({
      id,
      ...body
    }: {
      id: string;
      labelOverride?: string | null;
      required?: boolean;
    }) => api.patch(`/preauth-layout/placements/${id}`, body),
  );
}

export function useRemovePlacement() {
  return useLayoutMutation((id: string) =>
    api.delete(`/preauth-layout/placements/${id}`),
  );
}

export function useSetSectionColumns() {
  return useOptimisticLayoutMutation(
    ({ id, columnCount }: { id: string; columnCount: number }) =>
      api.patch(`/preauth-layout/sections/${id}/columns`, { columnCount }),
    (layout, { id, columnCount }) => ({
      ...layout,
      sections: layout.sections.map((s) =>
        s.id === id ? { ...s, columnCount } : s,
      ),
    }),
  );
}

export function useReorderPlacements() {
  return useOptimisticLayoutMutation(
    (
      order: {
        id: string;
        sectionId: string;
        displayOrder: number;
        columnPosition?: number;
      }[],
    ) => api.patch("/preauth-layout/placements", { order }),
    (layout, order) => {
      const patchById = new Map(order.map((o) => [o.id, o]));
      // Placements arriving from another section need their full row —
      // their own section only has the ones already there.
      const movedIn = new Map(
        order
          .map((o) => findPlacementAnywhere(layout, o.id))
          .filter((p): p is PreauthPlacement => Boolean(p))
          .map((p) => [p.id, p] as const),
      );

      return {
        ...layout,
        sections: layout.sections.map((section) => {
          const staying = section.placements.filter((p) => {
            const patch = patchById.get(p.id);
            return !patch || patch.sectionId === section.id;
          });
          const arriving = order
            .filter(
              (o) =>
                o.sectionId === section.id &&
                !section.placements.some((p) => p.id === o.id),
            )
            .map((o) => movedIn.get(o.id))
            .filter((p): p is PreauthPlacement => Boolean(p));

          return {
            ...section,
            placements: [...staying, ...arriving].map((p) => {
              const patch = patchById.get(p.id);
              if (!patch) return p;
              return {
                ...p,
                displayOrder: patch.displayOrder,
                columnPosition: patch.columnPosition ?? p.columnPosition,
              };
            }),
          };
        }),
      };
    },
  );
}

export function useReorderSections() {
  return useOptimisticLayoutMutation(
    (order: { id: string; displayOrder: number }[]) =>
      api.patch("/preauth-layout/sections", { order }),
    (layout, order) => {
      const displayOrderById = new Map(
        order.map((o) => [o.id, o.displayOrder]),
      );
      return {
        ...layout,
        // The component renders sections in array order, not sorted by
        // displayOrder — the API does that sorting, which an optimistic
        // write has to do for itself or the drop would look like nothing
        // moved until the real response arrived anyway.
        sections: [...layout.sections]
          .map((s) => ({
            ...s,
            displayOrder: displayOrderById.get(s.id) ?? s.displayOrder,
          }))
          .sort((a, b) => a.displayOrder - b.displayOrder),
      };
    },
  );
}

/**
 * Gives one insurer a form of their own, cloned from what they use now.
 *
 * Every other write here is addressed by section or placement id, so
 * once the clone exists the editor edits it with no other change.
 */
export function useCustomiseForInsurer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (insurerId: string) =>
      api.post<PreauthLayout>("/preauth-layout/for-insurer", { insurerId }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["preauth-layout"] }),
  });
}

/** Drops it; claims already opened keep the form they were sent on. */
export function useRevertToDefaultLayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (insurerId: string) =>
      api.delete<void>(`/preauth-layout/for-insurer/${insurerId}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["preauth-layout"] }),
  });
}

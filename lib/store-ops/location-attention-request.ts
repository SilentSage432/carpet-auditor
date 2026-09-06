/**
 * Pure attention request-token helper — late responses must not paint new dept.
 */

export type AttentionRequestToken = {
  generation: number;
  departmentId: string | null;
};

export function nextAttentionRequestToken(
  prevGeneration: number,
  departmentId: string | null
): AttentionRequestToken {
  return {
    generation: prevGeneration + 1,
    departmentId,
  };
}

export function isAttentionResponseCurrent(
  token: AttentionRequestToken,
  currentGeneration: number,
  currentDepartmentId: string | null
): boolean {
  return (
    token.generation === currentGeneration &&
    token.departmentId === currentDepartmentId &&
    (token.departmentId == null ||
      token.departmentId === currentDepartmentId)
  );
}

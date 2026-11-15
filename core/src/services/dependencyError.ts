/** zincir (plan §5.2, §5.8): dependency edit errors and their HTTP status. */
export type DependencyErrorCode =
  | "dependency_self"
  | "dependency_not_found"
  | "dependency_cross_project"
  | "dependency_cycle"
  | "dependencies_locked"
  | "too_many_dependencies";

export const MAX_DEPENDENCIES = 20;

const HTTP_STATUS: Record<DependencyErrorCode, number> = {
  dependency_self: 400,
  dependency_not_found: 404,
  dependency_cross_project: 400,
  dependency_cycle: 409,
  dependencies_locked: 409,
  too_many_dependencies: 400,
};

export class DependencyError extends Error {
  readonly code: DependencyErrorCode;
  readonly extra: Record<string, unknown>;

  constructor(code: DependencyErrorCode, extra: Record<string, unknown> = {}) {
    super(code);
    this.name = "DependencyError";
    this.code = code;
    this.extra = extra;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }

  /** Response body: `{ error: <code>, ...extra }` (e.g. `path` for a cycle). */
  toBody(): Record<string, unknown> {
    return { error: this.code, ...this.extra };
  }
}

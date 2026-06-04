/**
 * Shared pagination contract for all list endpoints.
 *
 * Usage:
 *   const { page, perPage } = parsePageParams(url.searchParams);
 *   const result = paginateQuery(db, countSql, rowsSql, params, { page, perPage });
 *   // result = { items, total, page, perPage }
 *
 * Response headers should include:
 *   X-Total-Count: result.total
 *   X-Page: result.page
 *   X-Per-Page: result.perPage
 */

export interface PageParams {
  page: number;
  perPage: number;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

/**
 * Parse `page` and `per_page` from URL search params.
 * Defaults: page=1, per_page=50. Caps per_page at maxPerPage.
 */
export function parsePageParams(
  searchParams: URLSearchParams,
  maxPerPage = 100,
): PageParams {
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const perPage = Math.min(
    maxPerPage,
    Math.max(1, parseInt(searchParams.get('per_page') ?? '50', 10) || 50),
  );
  return { page, perPage };
}

/**
 * Build response headers for a paginated result.
 */
export function paginationHeaders(result: PagedResult<unknown>): Record<string, string> {
  return {
    'X-Total-Count': String(result.total),
    'X-Page': String(result.page),
    'X-Per-Page': String(result.perPage),
  };
}

/**
 * Helper: compute OFFSET from page params.
 */
export function pageOffset({ page, perPage }: PageParams): { limit: number; offset: number } {
  return { limit: perPage, offset: (page - 1) * perPage };
}

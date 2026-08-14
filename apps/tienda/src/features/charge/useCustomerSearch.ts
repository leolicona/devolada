import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
/* Type-only import: the API schema is the contract, zod never ships to the app */
import type { CustomerSearchResponse } from "@devolada/api/charges-schema";
import { api, ApiError } from "../../api/client";

function useDebounced<T>(value: T, ms = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function useCustomerSearch(rawQuery: string) {
  const q = useDebounced(rawQuery.trim());
  const enabled = q.length >= 2;
  const query = useQuery<CustomerSearchResponse, ApiError>({
    queryKey: ["customer-search", q],
    queryFn: () => api<CustomerSearchResponse>(`/charges/customers?q=${encodeURIComponent(q)}`),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
  return { ...query, enabled, errorCode: query.error?.code ?? null };
}

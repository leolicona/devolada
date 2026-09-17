# Citation baseline: consta-api-merge

Recorded by T001 at `31c4c71` (the commit research.md read), before any file moved.
Command per file: `git show 31c4c71:<path> | grep -o "D[0-9][0-9]*" | sort | uniq -c`.
T047 re-runs the same command on each file's new home and confirms every token is still present.

## `apps/consta/src/auth/api-key.ts`

```
1 D5
```

## `apps/consta/src/db/schema.ts`

```
1 D1
1 D11
1 D13
1 D14
4 D15
1 D16
2 D2
1 D3
1 D5
1 D6
1 D7
2 D8
1 D9
```

## `apps/consta/src/env.ts`

```
2 D1
1 D16
1 D2
3 D5
1 D7
```

## `apps/consta/src/extraction/fetch.ts`

```
2 D7
```

## `apps/consta/src/extraction/gate.ts`

```
1 D1
2 D11
1 D13
1 D3
2 D4
1 D7
```

## `apps/consta/src/extraction/index.ts`

```
1 D2
```

## `apps/consta/src/extraction/reader.ts`

```
1 D3
1 D4
1 D5
```

## `apps/consta/src/extraction/shape.ts`

```
2 D1
1 D14
1 D15
1 D16
```

## `apps/consta/src/index.ts`

```
1 D6
1 D8
```

## `apps/consta/src/provider/apicep.ts`

```
2 D10
4 D11
1 D14
2 D15
2 D16
1 D3
1 D7
2 D9
```

## `apps/consta/src/provider/banks.ts`

```
1 D12
```

## `apps/consta/src/provider/types.ts`

```
3 D11
1 D14
2 D15
1 D2
1 D9
```

## `apps/consta/src/retry/suggest.ts`

```
3 D1
1 D2
2 D3
5 D4
2 D5
```

## `apps/consta/src/routes/admin/keys.ts`

```
2 D5
2 D7
```

## `apps/consta/src/routes/banks.ts`

```
1 D12
1 D8
```

## `apps/consta/src/routes/extract/index.ts`

```
3 D1
2 D15
2 D16
1 D19
1 D2
1 D3
1 D6
1 D7
1 D9
```

## `apps/consta/src/routes/extract/schema.ts`

```
1 D6
```

## `apps/consta/src/routes/validate/index.ts`

```
5 D1
5 D11
1 D12
2 D13
1 D14
4 D15
1 D16
1 D18
1 D19
4 D2
3 D3
1 D4
2 D5
1 D6
1 D8
1 D9
```

## `apps/consta/src/routes/validate/schema.ts`

```
2 D1
1 D11
1 D12
1 D13
1 D17
```

## `apps/consta/src/trust/history.ts`

```
3 D1
4 D3
3 D4
1 D5
1 D6
1 D7
1 D8
```


## Audit (T047, after the move)

Run 2026-09-16 on the branch, after T043–T045. For every file above, the same command on its new home. "present" means every token the original carried is in the new file (the new home may carry more — the `consta-api-merge D<n>` additions — never fewer). The first run found one token missing — `D19` in `extract.ts`, whose sentence ("every error says whether waiting can help — envelope law") lived on the router's `zValidator` block and dissolved with it; the rule survives as `retryable` on the in-process failure, so the citation was restored on `extractionFailure` and the audit re-run.

| Original | New home | Verdict |
| --- | --- | --- |
| `apps/consta/src/auth/api-key.ts` | — | retired with the door (research R11); its citations (D5) retire with it |
| `apps/consta/src/db/schema.ts` | `apps/api/src/db/schema.ts` | present (13 distinct tokens in the original) |
| `apps/consta/src/env.ts` | — | retired with the door (research R11); its citations (D1, D16, D2, D5, D7) retire with it |
| `apps/consta/src/extraction/fetch.ts` | `apps/api/src/consta/extraction/proof.ts` | present (1 distinct tokens in the original) |
| `apps/consta/src/extraction/gate.ts` | `apps/api/src/consta/extraction/gate.ts` | present (6 distinct tokens in the original) |
| `apps/consta/src/extraction/index.ts` | `apps/api/src/consta/extraction/index.ts` | present (1 distinct tokens in the original) |
| `apps/consta/src/extraction/reader.ts` | `apps/api/src/consta/extraction/reader.ts` | present (3 distinct tokens in the original) |
| `apps/consta/src/extraction/shape.ts` | `apps/api/src/consta/extraction/shape.ts` | present (4 distinct tokens in the original) |
| `apps/consta/src/index.ts` | — | retired with the door (research R11); its citations (D6, D8) retire with it |
| `apps/consta/src/provider/apicep.ts` | `apps/api/src/consta/provider/apicep.ts` | present (8 distinct tokens in the original) |
| `apps/consta/src/provider/banks.ts` | `apps/api/src/direct-payments/banks.ts` | present (1 distinct tokens in the original) |
| `apps/consta/src/provider/types.ts` | `apps/api/src/consta/provider/types.ts` | present (5 distinct tokens in the original) |
| `apps/consta/src/retry/suggest.ts` | `apps/api/src/consta/retry/suggest.ts` | present (5 distinct tokens in the original) |
| `apps/consta/src/routes/admin/keys.ts` | — | retired with the door (research R11); its citations (D5, D7) retire with it |
| `apps/consta/src/routes/banks.ts` | — | retired with the door (research R11); its citations (D12, D8) retire with it |
| `apps/consta/src/routes/extract/index.ts` | `apps/api/src/consta/extract.ts` | present (9 distinct tokens in the original) |
| `apps/consta/src/routes/extract/schema.ts` | `apps/api/src/consta/extract.ts` | present (1 distinct tokens in the original) |
| `apps/consta/src/routes/validate/index.ts` | `apps/api/src/consta/validate.ts` | present (16 distinct tokens in the original) |
| `apps/consta/src/routes/validate/schema.ts` | `apps/api/src/consta/request.ts` | present (5 distinct tokens in the original) |
| `apps/consta/src/trust/history.ts` | `apps/api/src/consta/trust/history.ts` | present (7 distinct tokens in the original) |

Result: every citation present (SC-011).

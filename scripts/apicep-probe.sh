#!/usr/bin/env bash
# Asks apiCEP directly and keeps every answer whole — no Devolada in between
# (bug: reference-finds-other-transfer, reference-search-business-day: the
# measurement the product creator asked for on 2026-09-26). The engine keeps
# only the verdict it derives; the questions left open (what a reference that
# matches several transfers answers, whether the CEP carries the operation's
# time, whether direct mode hides an already-validated CEP) need the raw body.
#
# Every case is one paid call. The token is asked for at run time, never
# echoed, never written to disk; APICEP_TOKEN in the environment skips the
# prompt. APICEP_BASE_URL points it elsewhere — `http://localhost:8789` is
# the sandbox (`pnpm --filter @devolada/api sandbox`), for a free dry run.
#
# Usage: scripts/apicep-probe.sh <cases.json> [output-dir]
# Needs: bash, curl, jq. The cases file's shape: scripts/apicep-probe.cases.example.json
set -euo pipefail

CASES="${1:-}"
if [ -z "$CASES" ] || [ ! -f "$CASES" ]; then
  echo "Uso: $0 <casos.json> [carpeta-de-salida]" >&2
  exit 2
fi
for tool in curl jq; do
  command -v "$tool" >/dev/null || { echo "Falta '$tool'." >&2; exit 2; }
done

BASE_URL="${APICEP_BASE_URL:-https://api.apicep.cloud}"
OUT="${2:-apicep-probe-$(date -u +%Y%m%dT%H%M%SZ)}"

# The file is checked whole before anything is spent: a case that cannot
# be sent must not be discovered after the first credits are gone.
PROBLEMS=$(jq -r '
  def key_count: ([.trackingKey, .referenceNumber] | map(select(. != null and . != "")) | length);
  (if (.beneficiary.bank // "") == "" or (.beneficiary.clabe // "" | test("^[0-9]{18}$") | not)
     then "beneficiary: necesita bank y una clabe de 18 dígitos" else empty end),
  (if (.cases | type) != "array" or (.cases | length) == 0 then "cases: vacío" else empty end),
  (.cases // [] | to_entries[] | .key as $i | .value as $c |
    ($c.id // "#\($i + 1)") as $id |
    if $c.imageUrl then
      (if ($c.imageUrl | test("^https://")) | not then "\($id): imageUrl debe ser https" else empty end)
    else
      (if ($c.date // "" | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")) | not then "\($id): date YYYY-MM-DD" else empty end),
      (if ($c.amountCents | type) != "number" or $c.amountCents <= 0 or ($c.amountCents | floor) != $c.amountCents
         then "\($id): amountCents entero > 0" else empty end),
      (if ($c.bank // "") == "" then "\($id): falta bank" else empty end),
      (if ($c | key_count) != 1 then "\($id): exactamente uno de trackingKey o referenceNumber" else empty end)
    end),
  ([.cases // [] | .[].id] | group_by(.) | map(select(length > 1) | .[0]) | .[] | "id repetido: \(.)")
' "$CASES")
if [ -n "$PROBLEMS" ]; then
  echo "El archivo de casos tiene problemas; no se consultó nada:" >&2
  echo "$PROBLEMS" | sed 's/^/  - /' >&2
  exit 2
fi

N=$(jq '.cases | length' "$CASES")
echo "Destino: $BASE_URL"
echo "Cuenta que recibe: $(jq -r '.beneficiary | "\(.bank) \(.clabe)"' "$CASES")"
echo
jq -r '.cases[] | if .imageUrl then "  \(.id)  imagen  \(.imageUrl)"
  else "  \(.id)  \(.date)  $\(.amountCents / 100)  \(.bank)  \(if .trackingKey then "clave \(.trackingKey)" else "ref \(.referenceNumber)" end)" end
  + (if .note then "   — \(.note)" else "" end)' "$CASES"
echo
read -r -p "Son $N consultas pagadas ($N créditos). Escribe SI para continuar: " OK
[ "$OK" = "SI" ] || { echo "Cancelado; no se consultó nada."; exit 1; }

if [ -z "${APICEP_TOKEN:-}" ]; then
  read -r -s -p "Token de apiCEP (no se muestra ni se guarda): " APICEP_TOKEN
  echo
fi
[ -n "$APICEP_TOKEN" ] || { echo "Sin token; no se consultó nada." >&2; exit 1; }

mkdir -p "$OUT"
SUMMARY="$OUT/summary.tsv"
printf 'id\thttp\tstatus\tcepStatus\tpreviouslyValidated\ttrackingKey\toperationDate\tamount\tsenderBank\terror\tquotaRemaining\tprocessingTime\tcepDetailsKeys\n' > "$SUMMARY"

for i in $(seq 0 $((N - 1))); do
  CASE=$(jq -c ".cases[$i]" "$CASES")
  ID=$(jq -r '.id' <<<"$CASE")
  # The request exactly as the engine builds it (consta/provider/apicep.ts):
  # decimal pesos from cents by division, one key only, the account given.
  BODY=$(jq -c --argjson b "$(jq -c '.beneficiary' "$CASES")" '
    if .imageUrl then {system: "SPEI", imageUrl, beneficiary: $b}
    else {system: "SPEI", beneficiary: $b,
          sender: ({date, amount: (.amountCents / 100), bank}
                   + (if .trackingKey then {trackingKey} else {referenceNumber} end))}
    end' <<<"$CASE")
  echo "$BODY" | jq . > "$OUT/$ID.request.json"

  HTTP=$(curl -sS --max-time 40 -X POST "$BASE_URL/validate-transfer" \
    -H "Authorization: Bearer $APICEP_TOKEN" \
    -H "Content-Type: application/json" \
    --data "$BODY" \
    -D "$OUT/$ID.headers.txt" -o "$OUT/$ID.response.raw" -w '%{http_code}' || echo "000")

  if jq . "$OUT/$ID.response.raw" > "$OUT/$ID.response.json" 2>/dev/null; then
    rm "$OUT/$ID.response.raw"
    RESP="$OUT/$ID.response.json"
  else
    rm -f "$OUT/$ID.response.json"
    RESP=/dev/null
  fi
  header() { grep -i "^$1:" "$OUT/$ID.headers.txt" 2>/dev/null | head -1 | cut -d: -f2- | tr -d ' \r' || true; }
  ROW=$(jq -r --arg id "$ID" --arg http "$HTTP" --arg quota "$(header X-RateLimit-Remaining)" --arg ms "$(header X-Processing-Time)" '
    [$id, $http, (.status // ""), (.validation.cepStatus // ""),
     (.validation.cepPreviouslyValidated | tostring),
     (.validation.cepDetails.trackingKey // ""), (.validation.cepDetails.operationDate // ""),
     (.validation.cepDetails.amount // "" | tostring), (.validation.cepDetails.senderBank // ""),
     (.error // ""), $quota, $ms,
     ((.validation.cepDetails // {}) | keys | join(","))] | @tsv' "$RESP" 2>/dev/null \
    || printf '%s\t%s\t\t\t\t\t\t\t\t(respuesta no es JSON)\t\t\t' "$ID" "$HTTP")
  echo "$ROW" >> "$SUMMARY"
  echo "$ROW" | awk -F'\t' '{ printf "%-4s HTTP %s  %-8s %-10s ya-validada=%s  %s %s %s\n", $1, $2, $3, $4, $5, $6, $7, $10 }'
done

echo
echo "Respuestas completas en: $OUT/  (resumen: $SUMMARY)"
echo "Contienen nombres y cuentas de quien envía: no las subas al repositorio."

# apiCEP bank vocabulary — generator input

Read by [`gen-banks.mjs`](gen-banks.mjs), which regenerates
`apps/api/src/direct-payments/banks.ts` from it (one constant since
consta-api-merge D14 — the engine imports the API's). Edit this file and
re-run the script; never edit the constant by hand —
`node scripts/gen-banks.mjs --check` fails CI when it drifts.

The parser takes every backticked name between the first entry of the list
below and the paragraph that closes it, so the two have to stay adjacent and
keep their wording. Nothing above this line may repeat those two anchors
verbatim, or the parser will match here instead of in the list.

This is generator input rather than prose, which is why it lives beside the
script instead of in the documentation. It was lifted verbatim on 2026-09-09
from `docs/legacy/integrations/apicep.md`, now
[`integrations/apicep.md`](https://github.com/leolicona/devoladapago-legacy-documentation/blob/main/integrations/apicep.md)
in the legacy documentation archive, which keeps the full measured apiCEP
contract this section belongs to — including what the vocabulary costs when it
is wrong.

### `bank`: never rejected, and still decides the verdict

apiCEP publishes `bank` as a closed vocabulary of 97 names. **It does not enforce
it** — measured 2026-08-19 — and that is worse than enforcing it. The
vocabulary:

`ACTINVER` `AFIRME` `albo` `ARCUS FI` `ASP INTEGRA OPC` `AZTECA` `BaBien` `BAJIO` `BANAMEX` `BANCO COVALTO` `BANCOMEXT` `BANCOPPEL` `BANCO S3` `BANCREA` `BANJERCITO` `BANKAOOL` `BANK OF AMERICA` `BANK OF CHINA` `BANOBRAS` `BANORTE` `BANREGIO` `BANSI` `BANXICO` `BARCLAYS` `BBASE` `BBVA MEXICO` `BMONEX` `CAJA POP MEXICA` `CAJA TELEFONIST` `CASHI CUENTA` `CB INTERCAM` `CI BOLSA` `CITI MEXICO` `CLS` `CoDi Valida` `COMPARTAMOS` `CONSUBANCO` `COOPDESARROLLO` `CREDICAPITAL` `CREDICLUB` `CRISTOBAL COLON` `Cuenca` `Dep y Pag Dig` `DONDE` `FINAMEX` `FINCOMUN` `FINCO PAY` `FONDEADORA` `FONDO (FIRA)` `GBM` `HEY BANCO` `HIPOTECARIA FED` `HSBC` `ICBC` `INBURSA` `INDEVAL` `INMOBILIARIO` `INTERCAM BANCO` `INVEX` `JP MORGAN` `KAPITAL` `KLAR` `KUSPIT` `LIBERTAD` `MASARI` `Mercado Pago W` `MexPago` `MIFEL` `MIZUHO BANK` `MONEXCB` `MUFG` `MULTIVA BANCO` `NAFIN` `NUBANK` `NVIO` `PAGATODO` `Peibo` `PROFUTURO` `REVOLUT` `SABADELL` `SANTANDER` `SCOTIABANK` `SHINHAN` `SPIN BY OXXO` `STP` `TESORED` `TRANSFER` `UALA` `UBER PRO CARD` `UNAGRA` `VALMEX` `VALUE` `VECTOR` `VE POR MAS` `VOLKSWAGEN` `TRF` `CLIP`

The names are not the ones a customer would type: it is `NUBANK`, not "Nu";
`BBVA MEXICO`, not "BBVA"; `AZTECA`, not "Banco Azteca". Casing is inconsistent
(8 of the 97 are not fully uppercase: `albo`, `BaBien`, `CoDi Valida`, `Cuenca`, `Dep y Pag Dig`, `Mercado Pago W`, `MexPago`, `Peibo`).

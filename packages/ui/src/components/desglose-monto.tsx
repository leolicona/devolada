import { formatearMonto } from "../lib/monto";

/* Fuente única del formato de dinero visible: comprobante, confirmación
   de cobro, detalle en admin y plantilla de WhatsApp derivan de aquí. */

export function Monto({
  centavos,
  signo = false,
  className = "",
}: {
  centavos: number;
  signo?: boolean;
  className?: string;
}) {
  return (
    <data value={(centavos / 100).toFixed(2)} className={`tabular-nums ${className}`}>
      {formatearMonto(centavos, { signo })}
    </data>
  );
}

export interface LineaDesglose {
  etiqueta: string;
  centavos: number;
}

export interface DesgloseMontoProps {
  /* ej. [{ etiqueta: "Mensualidad", centavos: 40000 },
          { etiqueta: "Cargo por servicio", centavos: 1500 }] */
  lineas: LineaDesglose[];
  etiquetaTotal?: string;
  className?: string;
}

export function DesgloseMonto({
  lineas,
  etiquetaTotal = "Total",
  className = "",
}: DesgloseMontoProps) {
  const total = lineas.reduce((suma, linea) => suma + linea.centavos, 0);
  return (
    <dl className={`space-y-2 text-base ${className}`}>
      {lineas.map((linea) => (
        <div key={linea.etiqueta} className="flex justify-between gap-4">
          <dt className="text-ink-soft">{linea.etiqueta}</dt>
          <dd>
            <Monto centavos={linea.centavos} />
          </dd>
        </div>
      ))}
      <div className="flex justify-between gap-4 border-t border-line-soft pt-2 font-semibold">
        <dt>{etiquetaTotal}</dt>
        <dd>
          <Monto centavos={total} />
        </dd>
      </div>
    </dl>
  );
}

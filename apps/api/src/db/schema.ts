import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/* Todo el dinero en centavos enteros. Timestamps en ms.
   Diseño para un ISP piloto, con ispId en todas las tablas para
   habilitar multi-tenant sin migración estructural. */

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const creadoEn = () =>
  integer("creado_en", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

export const isps = sqliteTable("isps", {
  id: id(),
  nombre: text("nombre").notNull(),
  correo: text("correo").notNull().unique(),
  correoVerificado: integer("correo_verificado", { mode: "boolean" })
    .notNull()
    .default(false),
  passwordHash: text("password_hash"),
  passwordSalt: text("password_salt"),
  wisphubApiKey: text("wisphub_api_key"),
  /* Comisión que paga el cliente final, y la parte de la tienda.
     La parte de la plataforma es la diferencia. */
  cargoServicioCentavos: integer("cargo_servicio_centavos").notNull().default(1500),
  comisionTiendaCentavos: integer("comision_tienda_centavos").notNull().default(900),
  estatus: text("estatus", { enum: ["activo", "suspendido"] })
    .notNull()
    .default("activo"),
  creadoEn: creadoEn(),
});

export const tiendas = sqliteTable(
  "tiendas",
  {
    id: id(),
    ispId: text("isp_id")
      .notNull()
      .references(() => isps.id),
    nombre: text("nombre").notNull(),
    responsable: text("responsable").notNull(),
    telefono: text("telefono").notNull().unique(),
    zona: text("zona"),
    /* null hasta que acepta la invitación */
    passwordHash: text("password_hash"),
    passwordSalt: text("password_salt"),
    /* null → hereda comisionTiendaCentavos del ISP */
    comisionCentavos: integer("comision_centavos"),
    techoSaldoCentavos: integer("techo_saldo_centavos").notNull().default(500000),
    estatus: text("estatus", { enum: ["invitada", "activa", "suspendida"] })
      .notNull()
      .default("invitada"),
    creadoEn: creadoEn(),
  },
  (t) => [index("tiendas_isp_idx").on(t.ispId)],
);

export const cobros = sqliteTable(
  "cobros",
  {
    id: id(),
    ispId: text("isp_id")
      .notNull()
      .references(() => isps.id),
    tiendaId: text("tienda_id")
      .notNull()
      .references(() => tiendas.id),
    folio: text("folio").notNull().unique(),
    clienteWisphubId: text("cliente_wisphub_id").notNull(),
    clienteNombre: text("cliente_nombre").notNull(),
    clienteZona: text("cliente_zona"),
    mensualidadCentavos: integer("mensualidad_centavos").notNull(),
    cargoServicioCentavos: integer("cargo_servicio_centavos").notNull(),
    totalCentavos: integer("total_centavos").notNull(),
    estadoReconexion: text("estado_reconexion", {
      enum: ["en_cola", "reconectado", "fallido"],
    })
      .notNull()
      .default("en_cola"),
    intentosReconexion: integer("intentos_reconexion").notNull().default(0),
    reconectadoEn: integer("reconectado_en", { mode: "timestamp_ms" }),
    creadoEn: creadoEn(),
  },
  (t) => [
    index("cobros_tienda_idx").on(t.tiendaId),
    index("cobros_isp_creado_idx").on(t.ispId, t.creadoEn),
  ],
);

export const entregas = sqliteTable(
  "entregas",
  {
    id: id(),
    tiendaId: text("tienda_id")
      .notNull()
      .references(() => tiendas.id),
    centavos: integer("centavos").notNull(),
    estado: text("estado", { enum: ["pendiente", "confirmada", "en_disputa"] })
      .notNull()
      .default("pendiente"),
    nota: text("nota"),
    confirmadaEn: integer("confirmada_en", { mode: "timestamp_ms" }),
    creadoEn: creadoEn(),
  },
  (t) => [index("entregas_tienda_idx").on(t.tiendaId)],
);

/* Ledger append-only: nunca UPDATE ni DELETE sobre esta tabla.
   Correcciones = contra-asientos. Balance de una tienda = SUM(centavos).
   cobro: +total · comision: −parte de la tienda · entrega: −monto entregado */
export const movimientos = sqliteTable(
  "movimientos",
  {
    id: id(),
    tiendaId: text("tienda_id")
      .notNull()
      .references(() => tiendas.id),
    tipo: text("tipo", { enum: ["cobro", "comision", "entrega"] }).notNull(),
    centavos: integer("centavos").notNull(),
    cobroId: text("cobro_id").references(() => cobros.id),
    entregaId: text("entrega_id").references(() => entregas.id),
    creadoEn: creadoEn(),
  },
  (t) => [index("movimientos_tienda_creado_idx").on(t.tiendaId, t.creadoEn)],
);

export const invitaciones = sqliteTable(
  "invitaciones",
  {
    id: id(),
    tiendaId: text("tienda_id")
      .notNull()
      .references(() => tiendas.id),
    /* token emitido por Agnostic Auth /auth/initiate */
    token: text("token").notNull().unique(),
    estado: text("estado", { enum: ["enviada", "aceptada"] })
      .notNull()
      .default("enviada"),
    aceptadaEn: integer("aceptada_en", { mode: "timestamp_ms" }),
    creadoEn: creadoEn(),
  },
  (t) => [index("invitaciones_tienda_idx").on(t.tiendaId)],
);

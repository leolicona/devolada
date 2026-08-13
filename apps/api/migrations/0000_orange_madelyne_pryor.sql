CREATE TABLE `cobros` (
	`id` text PRIMARY KEY NOT NULL,
	`isp_id` text NOT NULL,
	`tienda_id` text NOT NULL,
	`folio` text NOT NULL,
	`cliente_wisphub_id` text NOT NULL,
	`cliente_nombre` text NOT NULL,
	`cliente_zona` text,
	`mensualidad_centavos` integer NOT NULL,
	`cargo_servicio_centavos` integer NOT NULL,
	`total_centavos` integer NOT NULL,
	`estado_reconexion` text DEFAULT 'en_cola' NOT NULL,
	`intentos_reconexion` integer DEFAULT 0 NOT NULL,
	`reconectado_en` integer,
	`creado_en` integer NOT NULL,
	FOREIGN KEY (`isp_id`) REFERENCES `isps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tienda_id`) REFERENCES `tiendas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cobros_folio_unique` ON `cobros` (`folio`);--> statement-breakpoint
CREATE INDEX `cobros_tienda_idx` ON `cobros` (`tienda_id`);--> statement-breakpoint
CREATE INDEX `cobros_isp_creado_idx` ON `cobros` (`isp_id`,`creado_en`);--> statement-breakpoint
CREATE TABLE `entregas` (
	`id` text PRIMARY KEY NOT NULL,
	`tienda_id` text NOT NULL,
	`centavos` integer NOT NULL,
	`estado` text DEFAULT 'pendiente' NOT NULL,
	`nota` text,
	`confirmada_en` integer,
	`creado_en` integer NOT NULL,
	FOREIGN KEY (`tienda_id`) REFERENCES `tiendas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entregas_tienda_idx` ON `entregas` (`tienda_id`);--> statement-breakpoint
CREATE TABLE `invitaciones` (
	`id` text PRIMARY KEY NOT NULL,
	`tienda_id` text NOT NULL,
	`token` text NOT NULL,
	`estado` text DEFAULT 'enviada' NOT NULL,
	`aceptada_en` integer,
	`creado_en` integer NOT NULL,
	FOREIGN KEY (`tienda_id`) REFERENCES `tiendas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitaciones_token_unique` ON `invitaciones` (`token`);--> statement-breakpoint
CREATE INDEX `invitaciones_tienda_idx` ON `invitaciones` (`tienda_id`);--> statement-breakpoint
CREATE TABLE `isps` (
	`id` text PRIMARY KEY NOT NULL,
	`nombre` text NOT NULL,
	`correo` text NOT NULL,
	`correo_verificado` integer DEFAULT false NOT NULL,
	`password_hash` text,
	`password_salt` text,
	`wisphub_api_key` text,
	`cargo_servicio_centavos` integer DEFAULT 1500 NOT NULL,
	`comision_tienda_centavos` integer DEFAULT 900 NOT NULL,
	`estatus` text DEFAULT 'activo' NOT NULL,
	`creado_en` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `isps_correo_unique` ON `isps` (`correo`);--> statement-breakpoint
CREATE TABLE `movimientos` (
	`id` text PRIMARY KEY NOT NULL,
	`tienda_id` text NOT NULL,
	`tipo` text NOT NULL,
	`centavos` integer NOT NULL,
	`cobro_id` text,
	`entrega_id` text,
	`creado_en` integer NOT NULL,
	FOREIGN KEY (`tienda_id`) REFERENCES `tiendas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cobro_id`) REFERENCES `cobros`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entrega_id`) REFERENCES `entregas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `movimientos_tienda_creado_idx` ON `movimientos` (`tienda_id`,`creado_en`);--> statement-breakpoint
CREATE TABLE `tiendas` (
	`id` text PRIMARY KEY NOT NULL,
	`isp_id` text NOT NULL,
	`nombre` text NOT NULL,
	`responsable` text NOT NULL,
	`telefono` text NOT NULL,
	`zona` text,
	`password_hash` text,
	`password_salt` text,
	`comision_centavos` integer,
	`techo_saldo_centavos` integer DEFAULT 500000 NOT NULL,
	`estatus` text DEFAULT 'invitada' NOT NULL,
	`creado_en` integer NOT NULL,
	FOREIGN KEY (`isp_id`) REFERENCES `isps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tiendas_telefono_unique` ON `tiendas` (`telefono`);--> statement-breakpoint
CREATE INDEX `tiendas_isp_idx` ON `tiendas` (`isp_id`);
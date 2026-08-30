DROP INDEX `payment_links_isp_customer_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `payment_links_isp_usuario_idx` ON `payment_links` (`isp_id`,`customer_usuario`);
# WispHub — colección de Postman

`wisphub.postman_collection.json` (Postman v2.1) lista los 67 endpoints del
API de WispHub v1.2.0 (`api-main.yaml`), agrupados como en su documentación.

- **Autenticación**: la colección envía `Authorization: Api-Key {{wisphub_api_key}}`.
  Pon la clave en un *entorno* de Postman, nunca en este archivo.
- **`baseUrl`**: sandbox por defecto (`https://sandbox-api.wisphub.net`);
  producción es `https://api.wisphub.net`.
- **Qué es medido y qué es inferido**: el `api-main.yaml` que se recibió solo
  trae las rutas (sus `$ref` apuntan a archivos que no venían). Las peticiones
  cuya descripción dice "Medido por Devolada" copian exactamente lo que
  `apps/api/src/wisphub/client.ts` usa contra la API real. En el resto, el
  método y el cuerpo son una inferencia: verificar contra
  https://wisphub.net/documentacion/home-1/ antes de confiar en ellos.

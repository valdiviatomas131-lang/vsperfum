# Casa Ámbar

Tienda en HTML, CSS y JavaScript, con un servidor Node.js pequeño. Los datos de catálogo, stock, categorías, descuentos, pedidos y apariencia se guardan en **Supabase PostgreSQL**; las imágenes se suben al bucket remoto `product-images`. El navegador no guarda el catálogo y el servidor no usa archivos locales para persistir la tienda.

## Preparar Supabase

1. Creá un proyecto en [Supabase](https://supabase.com/).
2. En **SQL Editor**, ejecutá el contenido completo de [`supabase/schema.sql`](./supabase/schema.sql). Crea las tablas, las funciones transaccionales y el bucket público de imágenes. La tienda comienza sin productos de muestra para no publicar precios o inventario ficticios.
3. En **Project Settings → API**, copiá la **Project URL** y la clave **service_role**. La clave `service_role` es secreta: usala solo como variable del servidor. Nunca la pegues en `app.js`, en el HTML ni en una variable `VITE_*`.

Las tablas tienen RLS activado y no dan acceso directo al público. El servidor usa la clave de servicio y solo entrega al catálogo público los datos necesarios. El alta de pedidos y el descuento de inventario se realizan juntos mediante una función SQL transaccional.

## Ejecutar localmente

Necesitás Node.js 18 o superior. En PowerShell, desde esta carpeta:

```powershell
$env:SUPABASE_URL = "https://TU-PROYECTO.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "TU_CLAVE_SERVICE_ROLE"
$env:ADMIN_PASSWORD = "una-frase-secreta-de-al-menos-12-caracteres"
$env:SESSION_SECRET = (node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
npm start
```

Abrí `http://localhost:3001`. El catálogo aparece vacío hasta que cargues tus productos desde **Configuración → Acceso administrador**. El puerto puede cambiarse con `PORT`.

## Publicar y compartir el enlace

Publicá esta carpeta como un servicio **Node.js** en Render, Railway u otro hosting que ejecute `npm start`. En la configuración del servicio, agregá estos secretos/variables:

- `SUPABASE_URL`: URL del proyecto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: clave privada `service_role`.
- `ADMIN_PASSWORD`: contraseña privada de administrador (mínimo 12 caracteres).
- `SESSION_SECRET`: cadena aleatoria privada de al menos 32 caracteres.
- `NODE_ENV`: `production`.

El hosting debe permitir solicitudes salientes HTTPS a Supabase. Configurá el dominio HTTPS del servicio y compartí ese enlace. Todas las personas verán el mismo catálogo; los cambios guardados por el administrador se escriben directamente en la base remota y persisten entre despliegues. **No agregues las claves al repositorio ni las compartas en el chat.**

## Uso del panel

- Minorista y mayorista mantienen precio e inventario independientes por producto. Un precio `0` oculta ese producto de esa modalidad.
- Cada producto admite hasta cinco fotos; se redimensionan a un máximo de 1200 px, se comprimen en WebP en el navegador y se guardan en Supabase Storage.
- Las promociones se pueden limitar por modalidad, producto o categoría, e incluir un código y un mínimo de compra.
- La confirmación del pedido y la actualización de stock son atómicas. El pago y la entrega se coordinan fuera de línea; no se procesan cobros.

create table if not exists public.store_settings (
  id text primary key check (id = 'default'),
  name text not null,
  tagline text not null default '',
  accent text not null default '#a64f36',
  background text not null default '#f7f3eb',
  ink text not null default '#29251f',
  avatar_url text,
  whatsapp text not null default ''
);

create table if not exists public.categories (
  name text primary key check (length(name) between 1 and 60)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  category text,
  description text not null default '',
  notes text not null default '',
  image_urls text[] not null default '{}',
  retail_price integer not null default 0 check (retail_price >= 0),
  retail_stock integer not null default 0 check (retail_stock >= 0),
  wholesale_price integer not null default 0 check (wholesale_price >= 0),
  wholesale_stock integer not null default 0 check (wholesale_stock >= 0),
  wholesale_minimum integer not null default 1 check (wholesale_minimum >= 1),
  created_at timestamptz not null default now()
);

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  code text unique,
  percent numeric(5, 2) not null check (percent > 0 and percent <= 90),
  active boolean not null default true,
  mode text not null default 'all' check (mode in ('all', 'retail', 'wholesale')),
  category text,
  product_id uuid references public.products(id) on delete set null,
  minimum integer not null default 0 check (minimum >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  customer jsonb not null,
  delivery text not null,
  payment text not null,
  items jsonb not null,
  subtotal bigint not null check (subtotal >= 0),
  discount bigint not null default 0 check (discount >= 0),
  total bigint not null check (total >= 0),
  coupon text
);

alter table public.store_settings enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.promotions enable row level security;
alter table public.orders enable row level security;

insert into public.store_settings (id, name, tagline)
values ('default', 'Casa Ámbar', 'Tubitos árabes, extractos y brumas elegidos para acompañar tu manera de sentir.')
on conflict (id) do nothing;

insert into public.categories (name) values
  ('Tubitos árabes'), ('Extractos'), ('Body splash')
on conflict (name) do nothing;

create or replace function public.rename_store_category(p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_new is null or length(trim(p_new)) = 0 or length(trim(p_new)) > 60 then
    raise exception 'El nombre de la categoría no es válido.';
  end if;
  if exists (select 1 from public.categories where lower(name) = lower(trim(p_new)) and name <> p_old) then
    raise exception 'Esa categoría ya existe.';
  end if;
  update public.categories set name = trim(p_new) where name = p_old;
  if not found then raise exception 'No encontramos esa categoría.'; end if;
  update public.products set category = trim(p_new) where category = p_old;
  update public.promotions set category = trim(p_new) where category = p_old;
end;
$$;

create or replace function public.delete_store_category(p_name text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.categories where name = p_name) then
    raise exception 'No encontramos esa categoría.';
  end if;
  update public.products set category = null where category = p_name;
  update public.promotions set category = null where category = p_name;
  delete from public.categories where name = p_name;
end;
$$;

create or replace function public.place_store_order(p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  input_item jsonb;
  order_item jsonb;
  product_row public.products%rowtype;
  promo_row public.promotions%rowtype;
  saved_order public.orders%rowtype;
  order_items jsonb := '[]'::jsonb;
  subtotal_value bigint := 0;
  discount_value bigint := 0;
  line_value bigint;
  quantity_value integer;
  mode_value text;
  coupon_value text := upper(trim(coalesce(p_order->>'coupon', '')));
  coupon_found boolean := false;
  coupon_eligible boolean := false;
begin
  if jsonb_typeof(p_order->'items') <> 'array' or jsonb_array_length(p_order->'items') = 0 then
    return jsonb_build_object('error', 'El carrito está vacío.', 'status', 400);
  end if;

  for input_item in select value from jsonb_array_elements(p_order->'items')
  loop
    if input_item->>'mode' not in ('retail', 'wholesale') then
      return jsonb_build_object('error', 'Revisá la modalidad de compra.', 'status', 400);
    end if;
    quantity_value := (input_item->>'quantity')::integer;
    mode_value := input_item->>'mode';
    select * into product_row from public.products
      where id = (input_item->>'id')::uuid for update;
    if not found then return jsonb_build_object('error', 'Uno de los productos ya no está disponible.', 'status', 409); end if;
    if mode_value = 'retail' then
      if product_row.retail_price <= 0 then return jsonb_build_object('error', product_row.name || ' no está disponible en venta minorista.', 'status', 409); end if;
      if product_row.retail_stock < quantity_value then return jsonb_build_object('error', 'No hay stock suficiente de ' || product_row.name || '. Disponible: ' || product_row.retail_stock || '.', 'status', 409); end if;
      line_value := product_row.retail_price;
    else
      if product_row.wholesale_price <= 0 then return jsonb_build_object('error', product_row.name || ' no está disponible en venta mayorista.', 'status', 409); end if;
      if quantity_value < product_row.wholesale_minimum then return jsonb_build_object('error', product_row.name || ' requiere un mínimo mayorista de ' || product_row.wholesale_minimum || ' unidades.', 'status', 400); end if;
      if product_row.wholesale_stock < quantity_value then return jsonb_build_object('error', 'No hay stock suficiente de ' || product_row.name || '. Disponible: ' || product_row.wholesale_stock || '.', 'status', 409); end if;
      line_value := product_row.wholesale_price;
    end if;
    subtotal_value := subtotal_value + line_value * quantity_value;
    if subtotal_value > 9000000000000000 then
      return jsonb_build_object('error', 'El importe del pedido supera el límite permitido.', 'status', 400);
    end if;
    order_items := order_items || jsonb_build_array(jsonb_build_object(
      'id', product_row.id, 'name', product_row.name, 'mode', mode_value,
      'quantity', quantity_value, 'unitPrice', line_value
    ));
  end loop;

  if coupon_value <> '' then
    select * into promo_row from public.promotions
      where code = coupon_value and active = true;
    if not found then return jsonb_build_object('error', 'El cupón no es válido o está inactivo.', 'status', 400); end if;
    coupon_found := true;
    if subtotal_value < promo_row.minimum then
      return jsonb_build_object('error', 'El cupón requiere una compra mínima de $' || promo_row.minimum || '.', 'status', 400);
    end if;
  end if;

  for order_item in select value from jsonb_array_elements(order_items)
  loop
    select * into product_row from public.products where id = (order_item->>'id')::uuid;
    mode_value := order_item->>'mode';
    if coupon_found then
      if (promo_row.mode = 'all' or promo_row.mode = mode_value)
        and (promo_row.category is null or promo_row.category = product_row.category)
        and (promo_row.product_id is null or promo_row.product_id = product_row.id) then
        line_value := (order_item->>'unitPrice')::bigint * (order_item->>'quantity')::bigint;
        discount_value := discount_value + round(line_value * promo_row.percent / 100)::bigint;
        coupon_eligible := true;
      end if;
    else
      select * into promo_row from public.promotions p
        where p.active = true and p.code is null and p.minimum <= subtotal_value
          and (p.mode = 'all' or p.mode = mode_value)
          and (p.category is null or p.category = product_row.category)
          and (p.product_id is null or p.product_id = product_row.id)
        order by p.percent desc
        limit 1;
      if found then
        line_value := (order_item->>'unitPrice')::bigint * (order_item->>'quantity')::bigint;
        discount_value := discount_value + round(line_value * promo_row.percent / 100)::bigint;
      end if;
    end if;
  end loop;

  if coupon_found and not coupon_eligible then
    return jsonb_build_object('error', 'El cupón no aplica a los productos o modalidad del carrito.', 'status', 400);
  end if;

  for order_item in select value from jsonb_array_elements(order_items)
  loop
    if order_item->>'mode' = 'retail' then
      update public.products set retail_stock = retail_stock - (order_item->>'quantity')::integer where id = (order_item->>'id')::uuid;
    else
      update public.products set wholesale_stock = wholesale_stock - (order_item->>'quantity')::integer where id = (order_item->>'id')::uuid;
    end if;
  end loop;

  insert into public.orders (customer, delivery, payment, items, subtotal, discount, total, coupon)
  values (
    coalesce(p_order->'customer', '{}'::jsonb),
    left(coalesce(p_order->>'delivery', 'A coordinar'), 100),
    left(coalesce(p_order->>'payment', 'A coordinar'), 100),
    order_items,
    subtotal_value,
    discount_value,
    subtotal_value - discount_value,
    case when coupon_found then coupon_value else null end
  )
  returning * into saved_order;
  return jsonb_build_object(
    'order', to_jsonb(saved_order),
    'whatsapp', (select whatsapp from public.store_settings where id = 'default')
  );
end;
$$;

revoke all on function public.rename_store_category(text, text) from public, anon, authenticated;
revoke all on function public.delete_store_category(text) from public, anon, authenticated;
revoke all on function public.place_store_order(jsonb) from public, anon, authenticated;
grant execute on function public.rename_store_category(text, text) to service_role;
grant execute on function public.delete_store_category(text) to service_role;
grant execute on function public.place_store_order(jsonb) to service_role;
grant all on public.store_settings, public.categories, public.products, public.promotions, public.orders to service_role;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

-- Class planner accounts (Race, 2026-10-28).
--
-- An instructor who only plans classes (Zach for Kickboxing, Dustin for Jiu
-- Jitsu) gets a row in class_planners. That opens the class planner and
-- nothing else. The 'instructor' role is not used for this: it passes
-- get_my_role()/is_staff() policies on about 75 tables (families, payments,
-- invoices), and an instructor needs none of that.
--
-- Who teaches a class is an account id, never a name:
--   schedule_template.default_instructor_id  the class's regular instructor, every week
--   class_plans.instructor_id                one week's own assignment, which overrides it
-- The *_instructor text columns stay as the name to display.
-- A planner can write only the class weeks assigned to their own account.

create table if not exists public.class_planners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid default auth.uid()
);
alter table public.class_planners enable row level security;

-- Reading your own row tells the planner you may plan. Adding and removing
-- goes through set_class_planner(), which is admin only.
drop policy if exists class_planners_read on public.class_planners;
create policy class_planners_read on public.class_planners for select to authenticated
  using (user_id = auth.uid() or get_my_role() = 'admin');

alter table public.class_plans add column if not exists instructor_id uuid references auth.users(id) on delete set null;
alter table public.schedule_template add column if not exists default_instructor_id uuid references auth.users(id) on delete set null;

-- Plans already assigned to 'Chief' belong to the admin account.
update public.class_plans cp set instructor_id = p.id
  from public.profiles p
 where cp.instructor = 'Chief' and cp.instructor_id is null
   and p.role = 'admin' and p.email = 'barestkd@gmail.com';

create or replace function public.is_class_planner()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    coalesce(get_my_role() in ('admin', 'instructor'), false)
    or exists (select 1 from class_planners where user_id = auth.uid()));
$$;

-- True when the signed-in account teaches this class that week: the week's
-- own assignment if it has one, otherwise the class's regular instructor.
-- Reads the stored rows, never the row being written, so nobody can claim a
-- class by writing their own id into it.
create or replace function public.class_week_is_mine(p_week date, p_day int, p_time text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and coalesce(
    (select cp.instructor_id = auth.uid() from class_plans cp
      where cp.week_start = p_week and cp.day = p_day and cp.time = p_time
        and cp.instructor_id is not null),
    (select t.default_instructor_id = auth.uid() from schedule_template t
      where t.day = p_day and t.time = p_time),
    false);
$$;

-- Beside the staff policies, which stay as they are (policies are OR'd).
drop policy if exists planner_read on public.class_plans;
create policy planner_read on public.class_plans for select to authenticated
  using (is_class_planner());

drop policy if exists planner_insert on public.class_plans;
create policy planner_insert on public.class_plans for insert to authenticated
  with check (is_class_planner() and instructor_id = auth.uid()
              and class_week_is_mine(week_start, day, time));

drop policy if exists planner_update on public.class_plans;
create policy planner_update on public.class_plans for update to authenticated
  using (is_class_planner() and class_week_is_mine(week_start, day, time))
  with check (is_class_planner() and instructor_id = auth.uid()
              and class_week_is_mine(week_start, day, time));

-- Everyone who can plan, for the admin's assign list and Instructors tab.
create or replace function public.class_planner_accounts()
returns table (id uuid, name text, email text, kind text)
language sql stable security definer set search_path = public as $$
  select p.id,
         coalesce(nullif(trim(p.name), ''), split_part(p.email, '@', 1)),
         p.email,
         case p.role when 'admin' then 'admin' when 'instructor' then 'instructor' else 'planner' end
    from profiles p
   where get_my_role() = 'admin'
     and (p.role in ('admin', 'instructor')
          or exists (select 1 from class_planners c where c.user_id = p.id))
   order by (p.role = 'admin') desc, 2;
$$;

-- Admin only: let an account plan classes, or stop it. Never touches role,
-- so nothing else in the business opens up.
create or replace function public.set_class_planner(p_email text, p_on boolean)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_name text;
begin
  if coalesce(get_my_role(), '') <> 'admin' then
    raise exception 'Only an admin can change who plans classes';
  end if;
  select p.id, p.name into v_id, v_name from profiles p
   where lower(p.email) = lower(trim(p_email)) limit 1;
  if v_id is null then
    select u.id into v_id from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
  end if;
  if v_id is null then
    return json_build_object('ok', false,
      'error', 'No account uses that email. They sign up in the curriculum app first.');
  end if;
  if p_on then
    insert into class_planners (user_id) values (v_id) on conflict (user_id) do nothing;
  else
    delete from class_planners where user_id = v_id;
  end if;
  return json_build_object('ok', true, 'id', v_id, 'name', v_name);
end $$;

revoke all on function public.class_planner_accounts() from public, anon;
revoke all on function public.set_class_planner(text, boolean) from public, anon;
grant execute on function public.class_planner_accounts() to authenticated;
grant execute on function public.set_class_planner(text, boolean) to authenticated;

// Regression tests for
// supabase/migrations/20260918234315_web_security_hardening.sql
//
// Each test fails against the previously deployed behaviour.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const doctorA = randomUUID(), assistantA = randomUUID(), doctorB = randomUUID();
let clinicA;
const hash = 'ab'.repeat(32);

async function asUser(id, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? '']);
  await db.exec(`set role ${role}`);
}

async function command(clinic, type, id, action, payload, version, op = randomUUID()) {
  const { rows } = await db.query(
    'select public.clinic_apply_command($1,$2,$3,$4,$5,$6::jsonb,$7) as receipt',
    [clinic, op, type, id, action, JSON.stringify(payload), version]);
  return rows[0].receipt;
}

async function newPatient(clinic, mobile = '01000000000') {
  return (await command(clinic, 'patient', randomUUID(), 'save', {
    full_name: 'Fictional patient', gender: 'Female', birth_date: '1990-04-12',
    mobile, notes: 'Test data only', alerts: '',
  }, 0)).entity;
}

async function begin({ id = randomUUID(), clinic = clinicA, patient, fileName = 'fictional.pdf',
  contentType = 'application/pdf', bytes = 321 } = {}) {
  const { rows } = await db.query(`select public.clinic_begin_attachment(
    $1,$2,$3,null,$4,$5,'Other','Test data only',$6,false,$7) as value`,
    [id, clinic, patient, fileName, contentType, bytes, hash]);
  return rows[0].value;
}

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; grant usage on schema auth to anon,authenticated;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz,email text);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  await db.exec(`create schema storage; grant usage on schema storage to anon,authenticated;
    create table storage.buckets(
      id text primary key,name text not null,public boolean not null default false,
      file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(
      id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),
      name text not null,owner_id uuid,metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
      unique(bucket_id,name));
    alter table storage.buckets enable row level security;
    alter table storage.objects enable row level security;
    grant all on storage.buckets,storage.objects to anon,authenticated;`);
  await db.exec(`alter default privileges in schema public grant all on tables to anon,authenticated;
    alter default privileges in schema public grant all on sequences to anon,authenticated;
    alter default privileges in schema public grant all on functions to anon,authenticated;`);
  for (const id of [doctorA, assistantA, doctorB]) {
    await db.query('insert into auth.users values($1,now(),$2)', [id, `${id}@example.test`]);
  }
  const directory = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter((n) => n.endsWith('.sql')).sort()) {
    try { await db.exec(await readFile(new URL(name, directory), 'utf8')); }
    catch (error) { throw new Error(`Migration ${name}: ${error.message} [${error.code}]`); }
  }
  await asUser(doctorA);
  clinicA = (await db.query("select public.clinic_create('Fictional clinic A') as id")).rows[0].id;
  await db.exec('reset role');
  await db.query("insert into public.clinic_memberships(clinic_id,user_id,role) values($1,$2,'assistant')", [clinicA, assistantA]);
});
after(async () => { await db?.close(); });

test('DB-01: wrappers are SECURITY DEFINER and implementations are not client-callable', async () => {
  await db.exec('reset role');
  const invoker = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'clinic\\_%' and not p.prosecdef`)).rows.map((r) => r.proname);
  assert.deepEqual(invoker, ['clinic_search_patients']);
  const callable = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='clinic_private' and has_function_privilege('authenticated',p.oid,'execute') order by 1`)).rows.map((r) => r.proname);
  assert.deepEqual(callable, ['allowed', 'attachment_object_allowed']);
  await asUser(assistantA);
  await assert.rejects(db.query(
    "select clinic_private.apply_command($1,$2,'patient',$3,'save','{}'::jsonb,0)",
    [clinicA, randomUUID(), randomUUID()]), (e) => e.code === '42501');
  // The public contract still works for its rightful actor.
  const patient = await newPatient(clinicA);
  assert.equal(patient.clinic_id, clinicA);
  // RLS still applies to the invoker search function.
  await asUser(doctorB);
  assert.equal((await db.query("select count(*)::int as n from public.clinic_search_patients($1,'')", [clinicA])).rows[0].n, 0);
});

test('DB-02: audit payload columns are not selectable; metadata columns are', async () => {
  await asUser(doctorA);
  await assert.rejects(db.query('select new_value from public.audit_events limit 1'), (e) => e.code === '42501');
  await assert.rejects(db.query('select * from public.audit_events limit 1'), (e) => e.code === '42501');
  const rows = (await db.query(
    'select id,clinic_id,actor_id,actor_role,action,object_type,object_id,occurred_at from public.audit_events where clinic_id=$1',
    [clinicA])).rows;
  assert.ok(rows.length >= 1);
  await asUser(assistantA);
  assert.equal((await db.query('select count(*)::int as n from public.audit_events')).rows[0].n, 0);
});

test('DB-03: a present file extension must match the verified content type', async () => {
  await asUser(assistantA);
  const patient = await newPatient(clinicA);
  await assert.rejects(begin({ patient: patient.id, fileName: 'report.html' }), /ATTACHMENT_EXTENSION/);
  await assert.rejects(begin({ patient: patient.id, fileName: 'scan.svg', contentType: 'image/png' }), /ATTACHMENT_EXTENSION/);
  await assert.rejects(begin({ patient: patient.id, fileName: 'photo.png', contentType: 'image/jpeg' }), /ATTACHMENT_EXTENSION/);
  assert.equal((await begin({ patient: patient.id, fileName: 'Photo.JPEG', contentType: 'image/jpeg' })).state, 'pending');
  assert.equal((await begin({ patient: patient.id, fileName: 'lab results 2026.09' })).state, 'pending');
  assert.equal((await begin({ patient: patient.id, fileName: 'no-extension' })).state, 'pending');
});

test('DB-03: finalize rejects a stored object whose mimetype differs from the record', async () => {
  await asUser(assistantA);
  const patient = await newPatient(clinicA);
  const staged = await begin({ patient: patient.id, bytes: 55 });
  await db.query(`insert into storage.objects(bucket_id,name,owner_id,metadata)
    values('clinic-documents',$1,$2,$3::jsonb)`,
    [staged.object_path, assistantA, JSON.stringify({ size: 55, mimetype: 'image/png' })]);
  await assert.rejects(db.query('select public.clinic_finalize_attachment($1)', [staged.id]), /ATTACHMENT_TYPE_MISMATCH/);
  await db.exec('reset role');
  await db.query("update storage.objects set metadata=$2::jsonb where name=$1",
    [staged.object_path, JSON.stringify({ size: 55, mimetype: 'application/pdf' })]);
  await asUser(assistantA);
  assert.equal((await db.query('select public.clinic_finalize_attachment($1) as v', [staged.id])).rows[0].v.state, 'ready');
});

test('DB-04: a user may administer at most twenty clinics', async () => {
  await asUser(doctorB);
  for (let i = 0; i < 20; i++) {
    await db.query('select public.clinic_create($1)', [`Fictional clinic ${i}`]);
  }
  await assert.rejects(db.query("select public.clinic_create('Fictional clinic 21')"), /CLINIC_LIMIT/);
});

test('DB-04: presence rows per doctor are capped at ten devices', async () => {
  await asUser(doctorA);
  for (let i = 0; i < 14; i++) {
    await db.query('select public.clinic_doctor_heartbeat($1,$2)', [clinicA, randomUUID()]);
  }
  await db.exec('reset role');
  assert.equal((await db.query(
    'select count(*)::int as n from clinic_private.doctor_device_presence where clinic_id=$1 and doctor_id=$2',
    [clinicA, doctorA])).rows[0].n, 10);
});

test('DB-05: a mobile number cannot hide unbounded text around its digits', async () => {
  await asUser(assistantA);
  await assert.rejects(newPatient(clinicA, 'x'.repeat(41) + '0100000000'), (e) => e.code === '23514');
  assert.equal((await newPatient(clinicA, '+20 100 000 0000')).mobile, '+20 100 000 0000');
});

test('DB-06: new public tables are private by default', async () => {
  // PGlite drops a default-ACL row that only revokes PUBLIC execute, so the
  // function half of DB-06 is verified against the hosted catalog instead
  // (pg_default_acl for role postgres, schema public, objtype 'f').
  await db.exec('reset role');
  await db.exec('create table public.audit_probe_table(id int); create sequence public.audit_probe_seq;');
  assert.equal((await db.query("select has_table_privilege('authenticated','public.audit_probe_table','select') as v")).rows[0].v, false);
  assert.equal((await db.query("select has_table_privilege('anon','public.audit_probe_table','select') as v")).rows[0].v, false);
  assert.equal((await db.query("select has_sequence_privilege('authenticated','public.audit_probe_seq','usage') as v")).rows[0].v, false);
  await db.exec('drop table public.audit_probe_table; drop sequence public.audit_probe_seq;');
});

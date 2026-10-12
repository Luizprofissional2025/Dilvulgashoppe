import 'dotenv/config'; import fs from 'fs'; import express from 'express'; import cors from 'cors'; import multer from 'multer';
import jwt from 'jsonwebtoken'; import bcrypt from 'bcryptjs'; import pg from 'pg'; import IORedis from 'ioredis'; import { Queue, Worker } from 'bullmq'; import { z } from 'zod'; import { wa, startWA, sendViaWA } from './wa.js';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
const queue = new Queue('send', { connection: redis });
const WAMODE = process.env.SEND_MODE === 'wa'; // conexão direta (QR code), não oficial
const DEMO = !WAMODE && (!process.env.WA_TOKEN || !process.env.WA_PHONE_ID);
if (WAMODE) startWA();
fs.mkdirSync('uploads', { recursive: true });
const upload = multer({ dest: 'uploads/', limits: { fileSize: 16e6 } });
await db.query(`CREATE TABLE IF NOT EXISTS users(id serial PRIMARY KEY,email text UNIQUE NOT NULL,pass text NOT NULL);
CREATE TABLE IF NOT EXISTS groups(id serial PRIMARY KEY,user_id int NOT NULL,name text NOT NULL,group_id text NOT NULL);
CREATE TABLE IF NOT EXISTS schedules(id serial PRIMARY KEY,user_id int NOT NULL,group_ref int NOT NULL,message text NOT NULL,media_path text,media_mime text,run_at timestamptz NOT NULL,status text NOT NULL DEFAULT 'pending');
CREATE TABLE IF NOT EXISTS send_logs(id serial PRIMARY KEY,schedule_id int,ok boolean,detail text,at timestamptz DEFAULT now());`);

async function sendWhats(s: any) {
  if (WAMODE) return sendViaWA(s.group_id, s.message, s.media_path, s.media_mime);
  if (DEMO) { console.log('[DEMO] não enviado ->', s.group_id, s.message); return 'demo'; }
  const base = `https://graph.facebook.com/v21.0/${process.env.WA_PHONE_ID}`, h = { Authorization: `Bearer ${process.env.WA_TOKEN}` };
  let body: any = { messaging_product: 'whatsapp', recipient_type: 'group', to: s.group_id };
  if (s.media_path) {
    const fd = new FormData(); fd.append('messaging_product', 'whatsapp'); fd.append('type', s.media_mime);
    fd.append('file', new Blob([fs.readFileSync(s.media_path)], { type: s.media_mime }), 'arquivo');
    const up: any = await (await fetch(`${base}/media`, { method: 'POST', headers: h, body: fd })).json();
    if (!up.id) throw new Error(JSON.stringify(up));
    const t = s.media_mime.startsWith('video') ? 'video' : 'image';
    body = { ...body, type: t, [t]: { id: up.id, caption: s.message } };
  } else body = { ...body, type: 'text', text: { body: s.message } };
  const r = await fetch(`${base}/messages`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return JSON.stringify(j);
}

// Worker: o UPDATE atômico (pending -> sending) impede envio duplicado. Sem retry automático de propósito.
new Worker('send', async (job) => {
  const { rows: [s] } = await db.query(`UPDATE schedules SET status='sending' WHERE id=$1 AND status='pending'
    RETURNING *, (SELECT group_id FROM groups WHERE id=group_ref) AS group_id`, [job.data.id]);
  if (!s) return;
  try { const d = await sendWhats(s);
    await db.query(`UPDATE schedules SET status=$2 WHERE id=$1`, [s.id, DEMO ? 'demo' : 'sent']);
    await db.query(`INSERT INTO send_logs(schedule_id,ok,detail) VALUES($1,true,$2)`, [s.id, d]);
  } catch (e: any) {
    await db.query(`UPDATE schedules SET status='failed' WHERE id=$1`, [s.id]);
    await db.query(`INSERT INTO send_logs(schedule_id,ok,detail) VALUES($1,false,$2)`, [s.id, String(e.message)]);
  }
}, { connection: redis });

const app = express(); app.use(cors(), express.json());
const sign = (id: number) => jwt.sign({ id }, process.env.JWT_SECRET!, { expiresIn: '7d' });
const cred = z.object({ email: z.string().email(), password: z.string().min(8) });
app.post('/api/auth/register', async (req, res) => {
  if (process.env.ALLOW_REGISTER === 'false') return res.status(403).json({ error: 'Cadastro desativado.' });
  const p = cred.safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'E-mail inválido ou senha com menos de 8 caracteres.' });
  try { const { rows: [u] } = await db.query('INSERT INTO users(email,pass) VALUES($1,$2) RETURNING id', [p.data.email, await bcrypt.hash(p.data.password, 10)]); res.json({ token: sign(u.id) }); }
  catch { res.status(409).json({ error: 'Este e-mail já está cadastrado.' }); }
});
app.post('/api/auth/login', async (req, res) => {
  const p = cred.safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Dados inválidos.' });
  const { rows: [u] } = await db.query('SELECT * FROM users WHERE email=$1', [p.data.email]);
  if (!u || !(await bcrypt.compare(p.data.password, u.pass))) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  res.json({ token: sign(u.id) });
});
app.use('/api', (req: any, res, next) => { try { req.uid = (jwt.verify((req.headers.authorization || '').slice(7), process.env.JWT_SECRET!) as any).id; next(); } catch { res.status(401).json({ error: 'Sessão expirada.' }); } });
app.get('/api/wa/status', (_q, res) => res.json({ mode: WAMODE ? 'wa' : 'api', connected: wa.connected, qr: wa.qr }));
app.post('/api/wa/sync', async (q: any, res) => { for (const g of wa.groups) await db.query('INSERT INTO groups(user_id,name,group_id) SELECT $1,$2,$3 WHERE NOT EXISTS (SELECT 1 FROM groups WHERE user_id=$1 AND group_id=$3)', [q.uid, g.subject, g.id]); res.json({ ok: true }); });
app.get('/api/config', (_q, res) => res.json({ demo: DEMO }));
app.get('/api/groups', async (q: any, res) => res.json((await db.query('SELECT id,name,group_id FROM groups WHERE user_id=$1 ORDER BY name', [q.uid])).rows));
app.post('/api/groups', async (q: any, res) => {
  const p = z.object({ name: z.string().min(1), group_id: z.string().min(1) }).safeParse(q.body); if (!p.success) return res.status(400).json({ error: 'Informe nome e ID do grupo.' });
  res.json((await db.query('INSERT INTO groups(user_id,name,group_id) VALUES($1,$2,$3) RETURNING *', [q.uid, p.data.name, p.data.group_id])).rows[0]);
});
app.get('/api/schedules', async (q: any, res) => res.json((await db.query(`SELECT s.id,s.message,s.run_at,s.status,s.media_mime IS NOT NULL AS has_media,g.name AS group_name
  FROM schedules s JOIN groups g ON g.id=s.group_ref WHERE s.user_id=$1 ORDER BY s.run_at DESC LIMIT 100`, [q.uid])).rows));
app.post('/api/schedules', upload.single('file'), async (q: any, res) => {
  const p = z.object({ message: z.string().min(1), group_ref: z.coerce.number(), run_at: z.coerce.date() }).safeParse(q.body);
  if (!p.success || p.data.run_at.getTime() < Date.now() + 5000) return res.status(400).json({ error: 'Preencha mensagem, grupo e um horário no futuro.' });
  const max = Number(process.env.MAX_PER_DAY || 15);
  const n = (await db.query(`SELECT count(*)::int AS n FROM schedules WHERE user_id=$1 AND status<>'cancelled' AND (run_at AT TIME ZONE 'America/Sao_Paulo')::date=($2::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date`, [q.uid, p.data.run_at])).rows[0].n;
  if (n >= max) return res.status(400).json({ error: `Limite de ${max} envios por dia atingido para essa data.` });
  const g = await db.query('SELECT 1 FROM groups WHERE id=$1 AND user_id=$2', [p.data.group_ref, q.uid]); if (!g.rowCount) return res.status(404).json({ error: 'Grupo não encontrado.' });
  const { rows: [s] } = await db.query('INSERT INTO schedules(user_id,group_ref,message,media_path,media_mime,run_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
    [q.uid, p.data.group_ref, p.data.message, q.file?.path ?? null, q.file?.mimetype ?? null, p.data.run_at]);
  await queue.add('send', { id: s.id }, { delay: p.data.run_at.getTime() - Date.now(), jobId: `s${s.id}`, attempts: 1 }); res.json({ id: s.id });
});
app.delete('/api/schedules/:id', async (q: any, res) => {
  const r = await db.query(`UPDATE schedules SET status='cancelled' WHERE id=$1 AND user_id=$2 AND status='pending'`, [q.params.id, q.uid]);
  if (r.rowCount) await (await queue.getJob(`s${q.params.id}`))?.remove(); res.json({ ok: !!r.rowCount });
});
app.listen(3001, () => console.log(`API em :3001 ${DEMO ? '(MODO DEMONSTRAÇÃO)' : ''}`));

import { useEffect, useState, FormEvent } from 'react';
const api = async (path: string, opt: RequestInit = {}) => {
  const t = localStorage.getItem('t');
  const r = await fetch('/api' + path, { ...opt, headers: { ...(opt.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(t ? { Authorization: 'Bearer ' + t } : {}) } });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Erro inesperado.'); return j;
};
const rotulo: Record<string, string> = { pending: 'Agendada', sending: 'Enviando', sent: 'Enviada', demo: 'Simulada (demo)', failed: 'Falhou', cancelled: 'Cancelada' };
const campo = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 focus:outline-2 focus:outline-emerald-700';
const botao = 'rounded-lg bg-emerald-800 px-4 py-2 font-medium text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800';

function Login({ onOk }: { onOk: () => void }) {
  const [modo, setModo] = useState<'login' | 'register'>('login'); const [erro, setErro] = useState('');
  const enviar = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget);
    try { const r = await api(`/auth/${modo}`, { method: 'POST', body: JSON.stringify(Object.fromEntries(f)) }); localStorage.setItem('t', r.token); onOk(); } catch (x: any) { setErro(x.message); } };
  return (<main className="mx-auto max-w-sm p-6 pt-20"><h1 className="mb-6 text-3xl font-bold">AgendaZap</h1>
    <form onSubmit={enviar} className="space-y-3"><input name="email" type="email" placeholder="E-mail" required className={campo} />
      <input name="password" type="password" placeholder="Senha (mín. 8 caracteres)" required className={campo} />
      {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
      <button className={botao + ' w-full'}>{modo === 'login' ? 'Entrar' : 'Criar conta'}</button></form>
    <button className="mt-4 text-sm underline" onClick={() => setModo(modo === 'login' ? 'register' : 'login')}>{modo === 'login' ? 'Não tenho conta' : 'Já tenho conta'}</button></main>);
}

function Conexao({ onOk }: { onOk: () => void }) {
  const [s, setS] = useState<any>(null);
  useEffect(() => { let feito = false; const i = setInterval(async () => { try { const r = await api('/wa/status'); setS(r);
    if (r.connected && !feito) { feito = true; await api('/wa/sync', { method: 'POST' }); onOk(); } } catch {} }, 3000); return () => clearInterval(i); }, []);
  if (!s || s.mode !== 'wa') return null;
  if (s.connected) return <p className="rounded-lg bg-emerald-100 p-3 text-sm">WhatsApp conectado. Seus grupos já estão na lista.</p>;
  return (<section className="rounded-lg border border-stone-300 bg-white p-4"><h2 className="font-semibold">Conectar seu WhatsApp</h2>
    <p className="mb-3 text-sm">No celular: WhatsApp, Aparelhos conectados, Conectar um aparelho, e escaneie este código.</p>
    {s.qr ? <img src={s.qr} alt="QR code para conectar o WhatsApp" className="h-56 w-56" /> : <p className="text-sm">Gerando QR code…</p>}</section>);
}

export default function App() {
  const [logado, setLogado] = useState(!!localStorage.getItem('t')); const [demo, setDemo] = useState(false);
  const [grupos, setGrupos] = useState<any[]>([]); const [agend, setAgend] = useState<any[]>([]); const [erro, setErro] = useState('');
  const carregar = async () => { try { setGrupos(await api('/groups')); setAgend(await api('/schedules')); setDemo((await api('/config')).demo); } catch (x: any) { if (/Sess/.test(x.message)) sair(); } };
  const sair = () => { localStorage.removeItem('t'); setLogado(false); };
  useEffect(() => { if (logado) { carregar(); const i = setInterval(carregar, 15000); return () => clearInterval(i); } }, [logado]);
  if (!logado) return <Login onOk={() => setLogado(true)} />;
  const novoGrupo = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = e.currentTarget;
    try { await api('/groups', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(f))) }); f.reset(); carregar(); } catch (x: any) { setErro(x.message); } };
  const agendar = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = e.currentTarget; const d = new FormData(f);
    d.set('run_at', new Date(d.get('run_at') as string).toISOString()); if (!(d.get('file') as File).size) d.delete('file');
    try { await api('/schedules', { method: 'POST', body: d }); f.reset(); setErro(''); carregar(); } catch (x: any) { setErro(x.message); } };
  return (<main className="mx-auto max-w-3xl space-y-6 p-4">
    <header className="flex items-center justify-between"><h1 className="text-2xl font-bold">AgendaZap</h1><button onClick={sair} className="text-sm underline">Sair</button></header>
    <Conexao onOk={carregar} />
    {demo && <p className="rounded-lg bg-amber-100 p-3 text-sm">Modo demonstração: a API do WhatsApp não está configurada, então nenhuma mensagem é enviada de verdade.</p>}
    {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
    <section className="space-y-3"><h2 className="text-lg font-semibold">Novo agendamento</h2>
      <form onSubmit={agendar} className="space-y-3">
        <textarea name="message" required rows={4} placeholder="Mensagem" className={campo} />
        <input name="file" type="file" accept="image/*,video/*" className={campo} aria-label="Foto ou vídeo" />
        <div className="grid gap-3 sm:grid-cols-2"><input name="run_at" type="datetime-local" required className={campo} aria-label="Horário" />
          <select name="group_ref" required className={campo} aria-label="Grupo"><option value="">Escolha o grupo</option>{grupos.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
        <button className={botao}>Agendar envio</button></form></section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Grupos</h2>
      <form onSubmit={novoGrupo} className="flex flex-wrap gap-2"><input name="name" required placeholder="Nome (ex.: Achadinhos)" className={campo + ' flex-1'} />
        <input name="group_id" required placeholder="ID do grupo na API" className={campo + ' flex-1'} /><button className={botao}>Adicionar grupo</button></form>
      {!grupos.length && <p className="text-sm text-stone-600">Cadastre um grupo para começar a agendar.</p>}</section>
    <section><h2 className="mb-3 text-lg font-semibold">Histórico e fila</h2>
      <ul className="divide-y divide-stone-300 rounded-lg border border-stone-300 bg-white">{agend.map(a => (
        <li key={a.id} className="flex items-start justify-between gap-3 p-3"><div><p className="font-medium">{a.group_name}, {new Date(a.run_at).toLocaleString('pt-BR')}</p>
          <p className="line-clamp-2 text-sm text-stone-600">{a.has_media ? '[mídia] ' : ''}{a.message}</p></div>
          <div className="text-right text-sm"><p>{rotulo[a.status]}</p>{a.status === 'pending' && <button className="underline" onClick={async () => { await api('/schedules/' + a.id, { method: 'DELETE' }); carregar(); }}>Cancelar</button>}</div></li>))}
        {!agend.length && <li className="p-3 text-sm text-stone-600">Nenhum agendamento ainda.</li>}</ul></section></main>);
}

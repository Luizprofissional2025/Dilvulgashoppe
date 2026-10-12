import fs from 'fs'; import QRCode from 'qrcode';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
export const wa = { sock: null as any, qr: '', connected: false, groups: [] as { id: string; subject: string }[] };
export async function startWA() {
  const { state, saveCreds } = await useMultiFileAuthState('wa_auth');
  const { version } = await fetchLatestBaileysVersion();
  const sock: any = makeWASocket({ version, auth: state, browser: ['AgendaZap', 'Chrome', '1.0'] });
  wa.sock = sock; sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (u: any) => {
    if (u.qr) wa.qr = await QRCode.toDataURL(u.qr);
    if (u.connection === 'open') { wa.connected = true; wa.qr = '';
      wa.groups = Object.values(await sock.groupFetchAllParticipating()).map((g: any) => ({ id: g.id, subject: g.subject })); }
    if (u.connection === 'close') { wa.connected = false;
      if (u.lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) fs.rmSync('wa_auth', { recursive: true, force: true });
      setTimeout(startWA, 3000); }
  });
}
export async function sendViaWA(jid: string, text: string, path?: string, mime?: string) {
  if (!wa.connected) throw new Error('WhatsApp desconectado. Escaneie o QR code na tela.');
  const m: any = path ? (mime!.startsWith('video') ? { video: fs.readFileSync(path), caption: text } : { image: fs.readFileSync(path), caption: text }) : { text };
  await wa.sock.sendMessage(jid, m); return 'ok';
}

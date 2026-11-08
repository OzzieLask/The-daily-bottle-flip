// Big Screen Mode, host side: shows a QR code, accepts one phone controller.
import Peer, { type DataConnection } from 'peerjs';
import QRCode from 'qrcode';
import type { FlickSample } from '../input/motion';
import { controllerUrl, newRoomCode, PEER_PREFIX, type ToHost, type ToPhone } from './protocol';

export interface HostHandlers {
  onFlick(s: FlickSample): void;
  onReset(): void;
  onTest(on: boolean): void;
  onTilt(a: number): void;
  onConnect(): void;
  onDisconnect(): void;
  onError(msg: string): void;
}

export interface Host {
  code: string;
  url: string;
  connected: boolean;
  send(m: ToPhone): void;
  drawQr(canvas: HTMLCanvasElement): Promise<void>;
}

export function startHost(h: HostHandlers): Promise<Host> {
  return new Promise((resolve) => {
    let conn: DataConnection | null = null;

    const host: Host = {
      code: '',
      url: '',
      connected: false,
      send(m) {
        if (conn?.open) conn.send(m);
      },
      drawQr: (canvas) =>
        QRCode.toCanvas(canvas, host.url, {
          margin: 2,
          scale: 6,
          errorCorrectionLevel: 'M',
          color: { dark: '#1b1430', light: '#fff6e0' },
        }),
    };

    const open = () => {
      host.code = newRoomCode();
      host.url = controllerUrl(host.code);
      const peer = new Peer(PEER_PREFIX + host.code);

      peer.on('open', () => resolve(host));
      peer.on('connection', (c) => {
        // one controller at a time: the newest phone wins
        if (conn && conn !== c) conn.close();
        conn = c;
        c.on('data', (raw) => {
          const m = raw as ToHost;
          if (m.t === 'hello') {
            host.connected = true;
            h.onConnect();
          } else if (m.t === 'flick') h.onFlick(m.s);
          else if (m.t === 'reset') h.onReset();
          else if (m.t === 'test') h.onTest(m.on);
          else if (m.t === 'tilt') h.onTilt(m.a);
        });
        c.on('close', () => {
          if (conn !== c) return;
          conn = null;
          host.connected = false;
          h.onDisconnect();
        });
      });
      peer.on('disconnected', () => {
        // lost the broker; existing phone link may still work, but re-register
        if (!peer.destroyed) peer.reconnect();
      });
      peer.on('error', (err) => {
        const type = (err as { type?: string }).type;
        if (type === 'unavailable-id') {
          peer.destroy();
          open(); // code collision: pick another
        } else if (type === 'network' || type === 'server-error' || type === 'socket-error') {
          h.onError('Could not reach the pairing server. Check your connection and reload.');
        } else if (type === 'browser-incompatible') {
          h.onError('This browser does not support WebRTC pairing.');
        }
      });
    };
    open();
  });
}

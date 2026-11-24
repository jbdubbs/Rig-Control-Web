import net from 'net';

export interface SwrProxy {
  port: number;
  /** SWR value every `l SWR` read returns from now on. */
  setSwr(value: number): void;
  stop(): Promise<void>;
}

/**
 * A thin TCP proxy in front of a real Dummy rigctld. Hamlib's Dummy backend rejects `L SWR`
 * (RPRT -11) and always reads 0, so SWR-protection tests can't drive a real trip through it.
 * Everything is forwarded to the real rigctld untouched except:
 *   - `l SWR` is answered locally with the configured value
 *   - `G TUNE` (vfo_op TUNE) is forwarded, and additionally keys the rig for `tuneCarrierMs`
 *     through a second connection, standing in for the ATU tune carrier a real radio emits
 *     (the Dummy backend's TUNE does nothing on its own).
 */
export async function startSwrProxy(
  upstreamPort: number,
  opts: { tuneCarrierMs?: number } = {},
): Promise<SwrProxy> {
  const tuneCarrierMs = opts.tuneCarrierMs ?? 5000;
  let swr = 1.0;
  const sockets = new Set<net.Socket>();

  const runTuneCarrier = () => {
    const c = net.createConnection({ host: '127.0.0.1', port: upstreamPort });
    sockets.add(c);
    c.on('error', () => {});
    c.on('close', () => sockets.delete(c));
    c.on('connect', () => c.write('+T 1\n'));
    setTimeout(() => {
      if (!c.destroyed) {
        c.write('+T 0\n');
        setTimeout(() => c.destroy(), 200);
      }
    }, tuneCarrierMs);
  };

  const server = net.createServer((client) => {
    const upstream = net.createConnection({ host: '127.0.0.1', port: upstreamPort });
    sockets.add(client);
    sockets.add(upstream);
    const cleanup = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on('error', cleanup);
    upstream.on('error', cleanup);
    client.on('close', cleanup);
    upstream.on('close', cleanup);
    upstream.on('data', (d) => client.write(d));

    let buf = '';
    client.on('data', (d) => {
      buf += d.toString();
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        const cmd = line.trim();
        if (/^\+?\\?(l|get_level) SWR$/.test(cmd)) {
          client.write(`get_level: SWR\n${swr}\nRPRT 0\n`);
          continue;
        }
        if (/^\+?\\?(G|vfo_op) TUNE$/.test(cmd)) runTuneCarrier();
        upstream.write(line + '\n');
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as net.AddressInfo;

  return {
    port: addr.port,
    setSwr: (v) => { swr = v; },
    stop: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

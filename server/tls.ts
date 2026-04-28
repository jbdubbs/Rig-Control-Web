import os from "os";
import path from "path";
import fs from "fs";
import { X509Certificate } from "crypto";

export function getLanIPs(): string[] {
  const ips: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) ips.push(addr.address);
    }
  }
  return ips;
}

export async function loadOrGenerateCert(dataDir: string): Promise<{ key: string; cert: string }> {
  const keyPath = path.join(dataDir, "server.key.pem");
  const certPath = path.join(dataDir, "server.cert.pem");

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    try {
      const certPem = fs.readFileSync(certPath, "utf8");
      const x509 = new X509Certificate(certPem);
      const expiry = new Date(x509.validTo);
      const renewThreshold = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      if (expiry > renewThreshold) {
        const san = x509.subjectAltName ?? "";
        const lanIPs = getLanIPs();
        const allCovered = lanIPs.every(ip => san.includes(ip));
        if (allCovered) {
          console.log(`[TLS] Using existing certificate, valid until ${expiry.toDateString()}`);
          return { key: fs.readFileSync(keyPath, "utf8"), cert: certPem };
        }
        console.log("[TLS] LAN IP changed, regenerating certificate...");
      } else {
        console.log("[TLS] Certificate expires soon, regenerating...");
      }
    } catch {
      console.log("[TLS] Could not parse existing certificate, regenerating...");
    }
  }

  const { generate } = await import("selfsigned");
  const lanIPs = getLanIPs();
  const altNames = [
    { type: 2 as const, value: "localhost" },
    { type: 7 as const, ip: "127.0.0.1" },
    ...lanIPs.map(ip => ({ type: 7 as const, ip })),
  ];

  const notAfterDate = new Date();
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 1);

  console.log(`[TLS] Generating certificate for: localhost, 127.0.0.1${lanIPs.length ? ", " + lanIPs.join(", ") : ""}`);

  const pems = await generate(
    [{ name: "commonName", value: "localhost" }],
    {
      algorithm: "sha256",
      keyType: "ec",
      curve: "P-256",
      notAfterDate,
      extensions: [
        { name: "subjectAltName", altNames },
        { name: "basicConstraints", cA: false },
        { name: "keyUsage", digitalSignature: true },
        { name: "extKeyUsage", serverAuth: true },
      ],
    }
  );

  fs.writeFileSync(keyPath, pems.private, { mode: 0o600 });
  fs.writeFileSync(certPath, pems.cert);
  console.log(`[TLS] Certificate saved to ${dataDir}`);

  return { key: pems.private, cert: pems.cert };
}

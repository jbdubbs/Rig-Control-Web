#!/usr/bin/env python3
"""
CW keyer serial line helper for RigControl Web.
Spawned by server.ts; controls DTR or RTS via pyserial.

Usage: cw-key-helper.py <port_path> <dtr|rts> <high|low>
stdin:  "1\n" -> key active   "0\n" -> key inactive
stdout: "OPEN_OK\n" on success, "OPEN_ERROR: <msg>\n" on failure
"""
import sys
import serial


def main():
    if len(sys.argv) < 4:
        print("OPEN_ERROR: usage: cw-key-helper.py <port> <dtr|rts> <high|low>", flush=True)
        sys.exit(1)

    port_path, method, polarity = sys.argv[1], sys.argv[2], sys.argv[3]
    active_level = polarity == "high"

    try:
        s = serial.Serial(port_path, baudrate=9600)
    except Exception as e:
        print(f"OPEN_ERROR: {e}", flush=True)
        sys.exit(1)

    def set_line(active: bool):
        level = active_level if active else (not active_level)
        if method == "rts":
            s.rts = level
        else:
            s.dtr = level

    try:
        set_line(False)
        print("OPEN_OK", flush=True)
        while True:
            line = sys.stdin.readline()
            if not line:
                break
            cmd = line.strip()
            if cmd == "1":
                set_line(True)
            elif cmd == "0":
                set_line(False)
    except Exception:
        pass
    finally:
        try:
            set_line(False)
            s.close()
        except Exception:
            pass


main()

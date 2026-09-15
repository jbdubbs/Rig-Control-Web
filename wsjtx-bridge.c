/*
 * wsjtx-bridge.c — WSJTX rig-control bridge for RigControl Web.
 *
 * Runs two localhost-only servers in a single select() event loop:
 *   1. TCP server (default port 4540) speaking Hamlib rigctld extended protocol.
 *      WSJTX connects here via "Hamlib NET rigctl" → localhost:4540.
 *   2. WebSocket server (default port 4541) speaking a simple JSON protocol.
 *      The RigControl Web browser tab connects here to relay rig commands
 *      and status through its existing Socket.io session to the server.
 *
 * The helper never touches the network beyond localhost.  All rig commands
 * flow:  WSJTX → this helper → browser WebSocket → Socket.io → server → rigctld → radio.
 *
 * Usage:  wsjtx-bridge [--tcp-port 4540] [--ws-port 4541]
 * stdout: "READY <tcp_port> <ws_port>\n" once both servers are listening.
 *
 * Build:
 *   Linux:   gcc -O2 -o bin/linux/wsjtx-bridge wsjtx-bridge.c -lcrypto
 *   macOS:   clang -O2 -o bin/mac/wsjtx-bridge wsjtx-bridge.c -lcrypto
 *   Windows: cl wsjtx-bridge.c /Fe:bin\windows\wsjtx-bridge.exe /O2 /nologo
 *            ws2_32.lib advapi32.lib
 */

#ifdef _WIN32
  #define _CRT_SECURE_NO_WARNINGS
  #include <winsock2.h>
  #include <ws2tcpip.h>
  #include <windows.h>
  #include <wincrypt.h>
  #pragma comment(lib, "ws2_32.lib")
  #pragma comment(lib, "advapi32.lib")
  typedef SOCKET sock_t;
  #define SOCK_INVALID INVALID_SOCKET
  #define CLOSESOCK closesocket
  #define SOCKERR WSAGetLastError()
  static volatile int g_running = 1;
  static BOOL WINAPI console_handler(DWORD type) { (void)type; g_running = 0; return TRUE; }
  static void sock_init(void) {
      WSADATA wd;
      WSAStartup(MAKEWORD(2,2), &wd);
      SetConsoleCtrlHandler(console_handler, TRUE);
  }
#else
  #include <sys/socket.h>
  #include <sys/select.h>
  #include <netinet/in.h>
  #include <arpa/inet.h>
  #include <unistd.h>
  #include <fcntl.h>
  #include <signal.h>
  #include <errno.h>
  typedef int sock_t;
  #define SOCK_INVALID (-1)
  #define CLOSESOCK close
  #define SOCKERR errno
  static volatile int g_running = 1;
  static void handle_signal(int sig) { (void)sig; g_running = 0; }
  static void sock_init(void) {
      signal(SIGPIPE, SIG_IGN);
      signal(SIGINT, handle_signal);
      signal(SIGTERM, handle_signal);
  }
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <time.h>

/* ─── Limits ─────────────────────────────────────────────────────────────── */

#define MAX_TCP_CLIENTS   4
#define TCP_BUF_SIZE   4096
#define WS_BUF_SIZE   16384
#define CMD_TIMEOUT_MS 5000
#define MAX_PENDING_CMDS 32

static int verbose = 0;

#ifdef _WIN32
#define VLOG(...) do { if (verbose) { \
    DWORD _ms = GetTickCount(); \
    fprintf(stderr, "[wsjtx-bridge +%lu.%03lus] ", (unsigned long)(_ms/1000), (unsigned long)(_ms%1000)); \
    fprintf(stderr, __VA_ARGS__); fprintf(stderr, "\n"); } } while(0)
#else
#define VLOG(...) do { if (verbose) { \
    struct timespec _ts; clock_gettime(CLOCK_MONOTONIC, &_ts); \
    fprintf(stderr, "[wsjtx-bridge +%ld.%03lds] ", (long)_ts.tv_sec, _ts.tv_nsec/1000000); \
    fprintf(stderr, __VA_ARGS__); fprintf(stderr, "\n"); } } while(0)
#endif

/* ─── Cached rig state (updated by browser via WebSocket) ────────────────── */

static char  rig_frequency[32]  = "0";
static char  rig_mode[32]       = "USB";
static char  rig_bandwidth[32]  = "2400";
static int   rig_ptt            = 0;
static char  rig_vfo[16]        = "VFOA";
static int   rig_split          = 0;
static char  rig_tx_vfo[16]     = "VFOA";
static char  rig_split_freq[32] = "0";
static char  rig_split_mode[32] = "USB";
static char  rig_split_bw[32]   = "2400";

/*
 * Cache guard: after a SET command, protect the cached value from stale
 * rig-status overwrites for CACHE_GUARD_MS.  The server's 2 s poll cycle
 * means a stale status can arrive after we've already optimistically
 * updated the cache — without this guard, WSJTX reads back the old value.
 */
#define CACHE_GUARD_MS 3000
#ifdef _WIN32
static DWORD freq_set_at = 0;
static DWORD ptt_set_at  = 0;
static DWORD mode_set_at = 0;
static int cache_guard_active(DWORD set_at) {
    return set_at > 0 && (int)(GetTickCount() - set_at) < CACHE_GUARD_MS;
}
#else
static struct timespec freq_set_at = {0, 0};
static struct timespec ptt_set_at  = {0, 0};
static struct timespec mode_set_at = {0, 0};
static void stamp_now(struct timespec *ts) { clock_gettime(CLOCK_MONOTONIC, ts); }
static int cache_guard_active(struct timespec *set_at) {
    if (set_at->tv_sec == 0) return 0;
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    int ms = (int)((now.tv_sec - set_at->tv_sec) * 1000 +
                    (now.tv_nsec - set_at->tv_nsec) / 1000000);
    return ms < CACHE_GUARD_MS;
}
#endif

/* ─── Pending command tracking ───────────────────────────────────────────── */

typedef struct {
    int    id;
    int    in_use;
    sock_t tcp_sock;     /* which TCP client to respond to */
    char   response[512];
    int    responded;
#ifdef _WIN32
    DWORD  sent_at;
#else
    struct timespec sent_at;
#endif
} pending_cmd_t;

static pending_cmd_t pending_cmds[MAX_PENDING_CMDS];
static int next_cmd_id = 1;

static int ms_elapsed(pending_cmd_t *cmd) {
#ifdef _WIN32
    return (int)(GetTickCount() - cmd->sent_at);
#else
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (int)((now.tv_sec - cmd->sent_at.tv_sec) * 1000 +
                 (now.tv_nsec - cmd->sent_at.tv_nsec) / 1000000);
#endif
}

static pending_cmd_t *alloc_cmd(sock_t tcp_sock) {
    for (int i = 0; i < MAX_PENDING_CMDS; i++) {
        if (!pending_cmds[i].in_use) {
            pending_cmds[i].in_use   = 1;
            pending_cmds[i].id       = next_cmd_id++;
            pending_cmds[i].tcp_sock = tcp_sock;
            pending_cmds[i].responded = 0;
            pending_cmds[i].response[0] = '\0';
#ifdef _WIN32
            pending_cmds[i].sent_at = GetTickCount();
#else
            clock_gettime(CLOCK_MONOTONIC, &pending_cmds[i].sent_at);
#endif
            return &pending_cmds[i];
        }
    }
    return NULL;
}

static pending_cmd_t *find_cmd(int id) {
    for (int i = 0; i < MAX_PENDING_CMDS; i++) {
        if (pending_cmds[i].in_use && pending_cmds[i].id == id)
            return &pending_cmds[i];
    }
    return NULL;
}

static void expire_cmds(void) {
    for (int i = 0; i < MAX_PENDING_CMDS; i++) {
        if (pending_cmds[i].in_use && !pending_cmds[i].responded &&
            ms_elapsed(&pending_cmds[i]) > CMD_TIMEOUT_MS) {
            VLOG("TIMEOUT: cmd id=%d expired after %d ms with no response from browser",
                 pending_cmds[i].id, ms_elapsed(&pending_cmds[i]));
            pending_cmds[i].responded = 1;
            snprintf(pending_cmds[i].response, sizeof(pending_cmds[i].response),
                     "RPRT -1\n");
        }
    }
}

/* ─── SHA-1 for WebSocket handshake ──────────────────────────────────────── */

/*
 * Minimal SHA-1 implementation — used only for the WebSocket accept-key
 * handshake (RFC 6455 §4.2.2).  Not used for security purposes.
 */

static void sha1_block(unsigned int h[5], const unsigned char block[64]) {
    unsigned int w[80];
    for (int i = 0; i < 16; i++)
        w[i] = ((unsigned int)block[i*4]<<24) | ((unsigned int)block[i*4+1]<<16) |
               ((unsigned int)block[i*4+2]<<8) | block[i*4+3];
    for (int i = 16; i < 80; i++) {
        unsigned int t = w[i-3] ^ w[i-8] ^ w[i-14] ^ w[i-16];
        w[i] = (t << 1) | (t >> 31);
    }
    unsigned int a=h[0], b=h[1], c=h[2], d=h[3], e=h[4];
    for (int i = 0; i < 80; i++) {
        unsigned int f, k;
        if      (i < 20) { f = (b&c)|((~b)&d);       k = 0x5A827999; }
        else if (i < 40) { f = b^c^d;                  k = 0x6ED9EBA1; }
        else if (i < 60) { f = (b&c)|(b&d)|(c&d);     k = 0x8F1BBCDC; }
        else              { f = b^c^d;                  k = 0xCA62C1D6; }
        unsigned int tmp = ((a<<5)|(a>>27)) + f + e + k + w[i];
        e = d; d = c; c = (b<<30)|(b>>2); b = a; a = tmp;
    }
    h[0]+=a; h[1]+=b; h[2]+=c; h[3]+=d; h[4]+=e;
}

static void sha1(const unsigned char *data, size_t len, unsigned char out[20]) {
    unsigned int h[5] = {0x67452301,0xEFCDAB89,0x98BADCFE,0x10325476,0xC3D2E1F0};
    unsigned char block[64];
    size_t i;
    for (i = 0; i + 64 <= len; i += 64)
        sha1_block(h, data + i);
    size_t rem = len - i;
    memset(block, 0, 64);
    memcpy(block, data + i, rem);
    block[rem] = 0x80;
    if (rem >= 56) {
        sha1_block(h, block);
        memset(block, 0, 64);
    }
    unsigned long long bits = (unsigned long long)len * 8;
    for (int j = 0; j < 8; j++)
        block[56+j] = (unsigned char)(bits >> (56 - j*8));
    sha1_block(h, block);
    for (int j = 0; j < 5; j++) {
        out[j*4]   = (unsigned char)(h[j]>>24);
        out[j*4+1] = (unsigned char)(h[j]>>16);
        out[j*4+2] = (unsigned char)(h[j]>>8);
        out[j*4+3] = (unsigned char)(h[j]);
    }
}

/* ─── Base64 encode ──────────────────────────────────────────────────────── */

static const char b64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static void base64_encode(const unsigned char *in, size_t len, char *out) {
    size_t i, j = 0;
    for (i = 0; i + 2 < len; i += 3) {
        out[j++] = b64[in[i]>>2];
        out[j++] = b64[((in[i]&3)<<4)|(in[i+1]>>4)];
        out[j++] = b64[((in[i+1]&0xf)<<2)|(in[i+2]>>6)];
        out[j++] = b64[in[i+2]&0x3f];
    }
    if (i < len) {
        out[j++] = b64[in[i]>>2];
        if (i+1 < len) {
            out[j++] = b64[((in[i]&3)<<4)|(in[i+1]>>4)];
            out[j++] = b64[((in[i+1]&0xf)<<2)];
        } else {
            out[j++] = b64[((in[i]&3)<<4)];
            out[j++] = '=';
        }
        out[j++] = '=';
    }
    out[j] = '\0';
}

/* ─── Socket helpers ─────────────────────────────────────────────────────── */

static sock_t make_listen_socket(int port) {
    sock_t s = socket(AF_INET, SOCK_STREAM, 0);
    if (s == SOCK_INVALID) return SOCK_INVALID;

    int opt = 1;
#ifdef _WIN32
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));
#else
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
#endif

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons((unsigned short)port);

    if (bind(s, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        CLOSESOCK(s);
        return SOCK_INVALID;
    }
    if (listen(s, 4) < 0) {
        CLOSESOCK(s);
        return SOCK_INVALID;
    }
    return s;
}

static int send_all(sock_t s, const char *buf, int len) {
    int sent = 0;
    while (sent < len) {
        int n = send(s, buf + sent, len - sent, 0);
        if (n <= 0) return -1;
        sent += n;
    }
    return sent;
}

static void send_str(sock_t s, const char *str) {
    send_all(s, str, (int)strlen(str));
}

/* ─── WebSocket framing ─────────────────────────────────────────────────── */

/* Send a text frame (server→client, no masking) */
static int ws_send_text(sock_t s, const char *text) {
    size_t len = strlen(text);
    unsigned char hdr[10];
    int hdr_len;

    hdr[0] = 0x81; /* FIN + text opcode */
    if (len < 126) {
        hdr[1] = (unsigned char)len;
        hdr_len = 2;
    } else if (len < 65536) {
        hdr[1] = 126;
        hdr[2] = (unsigned char)(len >> 8);
        hdr[3] = (unsigned char)(len & 0xff);
        hdr_len = 4;
    } else {
        return -1; /* messages > 64K not needed */
    }

    if (send_all(s, (char*)hdr, hdr_len) < 0) return -1;
    if (send_all(s, text, (int)len) < 0) return -1;
    return 0;
}

/*
 * Decode one WebSocket frame from buf[0..buflen).
 * Returns bytes consumed (>0), 0 if incomplete, -1 on error/close.
 * Payload is written to out (null-terminated), *out_len set.
 */
static int ws_decode_frame(const unsigned char *buf, int buflen,
                           char *out, int out_cap, int *out_len, int *is_close) {
    *is_close = 0;
    if (buflen < 2) return 0;

    int fin    = (buf[0] >> 7) & 1;
    int opcode = buf[0] & 0x0f;
    int masked = (buf[1] >> 7) & 1;
    unsigned long long payload_len = buf[1] & 0x7f;
    int pos = 2;

    (void)fin; /* we only handle single-frame messages */

    if (payload_len == 126) {
        if (buflen < 4) return 0;
        payload_len = ((unsigned long long)buf[2] << 8) | buf[3];
        pos = 4;
    } else if (payload_len == 127) {
        if (buflen < 10) return 0;
        payload_len = 0;
        for (int i = 0; i < 8; i++)
            payload_len = (payload_len << 8) | buf[pos + i];
        pos = 10;
    }

    unsigned char mask[4] = {0,0,0,0};
    if (masked) {
        if (buflen < pos + 4) return 0;
        memcpy(mask, buf + pos, 4);
        pos += 4;
    }

    if ((unsigned long long)buflen < (unsigned long long)pos + payload_len) return 0;
    if ((int)payload_len >= out_cap) return -1;

    for (unsigned long long i = 0; i < payload_len; i++)
        out[i] = (char)(buf[pos + i] ^ mask[i & 3]);
    out[payload_len] = '\0';
    *out_len = (int)payload_len;

    if (opcode == 0x08) *is_close = 1; /* close frame */
    if (opcode == 0x09) {
        /* ping — send pong */
        /* (we handle this at the caller level) */
    }

    return pos + (int)payload_len;
}

/* ─── WebSocket handshake ────────────────────────────────────────────────── */

/* Returns 1 if the Origin header is present and looks like this app's own
 * page (https:// + loopback or private-LAN host) — i.e. plausibly the
 * RigControl Web tab, not an arbitrary external web page's background tab.
 * Browsers don't apply same-origin policy to outbound WebSocket connections
 * but always send Origin, so this mitigates a malicious external page
 * silently hijacking this loopback-only control channel. */
static int origin_is_allowed(const char *request) {
    const char *origin_hdr = strstr(request, "Origin:");
    if (!origin_hdr) origin_hdr = strstr(request, "origin:");
    if (!origin_hdr) return 0;

    origin_hdr += 7;
    while (*origin_hdr == ' ') origin_hdr++;

    char origin[128];
    int oi = 0;
    while (*origin_hdr && *origin_hdr != '\r' && *origin_hdr != '\n' && oi < (int)sizeof(origin) - 1)
        origin[oi++] = *origin_hdr++;
    origin[oi] = '\0';

    const char *scheme = "https://";
    size_t scheme_len = strlen(scheme);
    if (strncmp(origin, scheme, scheme_len) != 0) return 0;

    const char *host = origin + scheme_len;
    char hostbuf[64];
    int hi = 0;
    while (host[hi] && host[hi] != ':' && host[hi] != '/' && hi < (int)sizeof(hostbuf) - 1) {
        hostbuf[hi] = host[hi];
        hi++;
    }
    hostbuf[hi] = '\0';

    if (strcmp(hostbuf, "localhost") == 0 || strcmp(hostbuf, "127.0.0.1") == 0) return 1;

    unsigned a, b, c, d;
    if (sscanf(hostbuf, "%u.%u.%u.%u", &a, &b, &c, &d) == 4) {
        if (a == 10) return 1;
        if (a == 172 && b >= 16 && b <= 31) return 1;
        if (a == 192 && b == 168) return 1;
    }
    return 0;
}

/*
 * Parse the Sec-WebSocket-Key from an HTTP upgrade request,
 * compute the accept value, and send the 101 response.
 */
static int ws_do_handshake(sock_t s, const char *request) {
    if (!origin_is_allowed(request)) {
        fprintf(stderr, "wsjtx-bridge: WebSocket handshake rejected (Origin missing or not a loopback/LAN https origin)\n");
        return -1;
    }

    const char *key_hdr = strstr(request, "Sec-WebSocket-Key:");
    if (!key_hdr) key_hdr = strstr(request, "sec-websocket-key:");
    if (!key_hdr) return -1;

    key_hdr += 18; /* skip header name + colon */
    while (*key_hdr == ' ') key_hdr++;
    char key[64];
    int ki = 0;
    while (*key_hdr && *key_hdr != '\r' && *key_hdr != '\n' && ki < 62)
        key[ki++] = *key_hdr++;
    key[ki] = '\0';

    /* Trim trailing spaces */
    while (ki > 0 && key[ki-1] == ' ') key[--ki] = '\0';

    /* Concatenate with magic GUID */
    char concat[128];
    snprintf(concat, sizeof(concat), "%s258EAFA5-E914-47DA-95CA-C5AB0DC85B11", key);

    unsigned char hash[20];
    sha1((unsigned char*)concat, strlen(concat), hash);

    char accept[40];
    base64_encode(hash, 20, accept);

    char resp[512];
    snprintf(resp, sizeof(resp),
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: %s\r\n"
        "\r\n", accept);

    return send_all(s, resp, (int)strlen(resp)) < 0 ? -1 : 0;
}

/* ─── JSON helpers (minimal, no library) ─────────────────────────────────── */

/* Extract a string value for a given key from a JSON object.  Very minimal. */
static int json_get_str(const char *json, const char *key, char *out, int cap) {
    char pattern[128];
    snprintf(pattern, sizeof(pattern), "\"%s\"", key);
    const char *p = strstr(json, pattern);
    if (!p) return -1;
    p += strlen(pattern);
    while (*p == ' ' || *p == ':') p++;
    if (*p == '"') {
        p++;
        int i = 0;
        while (*p && *p != '"' && i < cap - 1) {
            if (*p == '\\' && *(p+1)) { p++; }
            out[i++] = *p++;
        }
        out[i] = '\0';
        return i;
    }
    return -1;
}

/* Extract an integer value for a given key */
static int json_get_int(const char *json, const char *key, int *out) {
    char pattern[128];
    snprintf(pattern, sizeof(pattern), "\"%s\"", key);
    const char *p = strstr(json, pattern);
    if (!p) return -1;
    p += strlen(pattern);
    while (*p == ' ' || *p == ':') p++;
    if (*p == '-' || (*p >= '0' && *p <= '9')) {
        *out = atoi(p);
        return 0;
    }
    /* handle booleans */
    if (strncmp(p, "true", 4) == 0) { *out = 1; return 0; }
    if (strncmp(p, "false", 5) == 0) { *out = 0; return 0; }
    return -1;
}

/* Extract a nested JSON object as a raw string */
static int json_get_obj(const char *json, const char *key, char *out, int cap) {
    char pattern[128];
    snprintf(pattern, sizeof(pattern), "\"%s\"", key);
    const char *p = strstr(json, pattern);
    if (!p) return -1;
    p += strlen(pattern);
    while (*p == ' ' || *p == ':') p++;
    if (*p != '{') return -1;
    int depth = 0;
    int i = 0;
    while (*p && i < cap - 1) {
        if (*p == '{') depth++;
        else if (*p == '}') { depth--; if (depth == 0) { out[i++] = *p; break; } }
        out[i++] = *p++;
    }
    out[i] = '\0';
    return i;
}

/* ─── Handle WebSocket message from browser ──────────────────────────────── */

static void handle_ws_message(const char *msg) {
    char event[64];
    if (json_get_str(msg, "event", event, sizeof(event)) < 0) return;

    if (strcmp(event, "rig-status") == 0) {
        char data[1024];
        if (json_get_obj(msg, "data", data, sizeof(data)) < 0) return;
#ifdef _WIN32
        if (!cache_guard_active(freq_set_at))
#else
        if (!cache_guard_active(&freq_set_at))
#endif
            json_get_str(data, "frequency", rig_frequency, sizeof(rig_frequency));
#ifdef _WIN32
        if (!cache_guard_active(mode_set_at)) {
#else
        if (!cache_guard_active(&mode_set_at)) {
#endif
            json_get_str(data, "mode", rig_mode, sizeof(rig_mode));
            json_get_str(data, "bandwidth", rig_bandwidth, sizeof(rig_bandwidth));
        }
#ifdef _WIN32
        if (!cache_guard_active(ptt_set_at))
#else
        if (!cache_guard_active(&ptt_set_at))
#endif
            json_get_int(data, "ptt", &rig_ptt);
        json_get_str(data, "vfo", rig_vfo, sizeof(rig_vfo));
        json_get_int(data, "isSplit", &rig_split);
        json_get_str(data, "txVFO", rig_tx_vfo, sizeof(rig_tx_vfo));
        VLOG("rig-status updated: freq=%s mode=%s bw=%s ptt=%d vfo=%s split=%d txVFO=%s",
             rig_frequency, rig_mode, rig_bandwidth, rig_ptt, rig_vfo, rig_split, rig_tx_vfo);
    } else if (strcmp(event, "cmd-result") == 0) {
        int id = 0;
        if (json_get_int(msg, "id", &id) < 0) return;
        pending_cmd_t *cmd = find_cmd(id);
        if (!cmd) return;

        int ok = 0;
        json_get_int(msg, "ok", &ok);
        if (ok) {
            snprintf(cmd->response, sizeof(cmd->response), "RPRT 0\n");
            VLOG("cmd-result id=%d: OK", id);
        } else {
            char err[256] = "";
            json_get_str(msg, "error", err, sizeof(err));
            snprintf(cmd->response, sizeof(cmd->response), "RPRT -1\n");
            VLOG("cmd-result id=%d: FAIL error=%s", id, err);
        }
        cmd->responded = 1;
    } else {
        VLOG("Unknown event: %s", event);
    }
}

/* ─── Send a rig command to browser via WebSocket, return pending_cmd ───── */

static sock_t ws_client = SOCK_INVALID;
static sock_t g_close_after_cmd = SOCK_INVALID;

static pending_cmd_t *send_rig_cmd(sock_t tcp_sock,
                                    const char *cmd_name, const char *args_json) {
    if (ws_client == SOCK_INVALID) {
        VLOG("send_rig_cmd(%s): no WebSocket client connected", cmd_name);
        return NULL;
    }
    pending_cmd_t *pc = alloc_cmd(tcp_sock);
    if (!pc) {
        VLOG("send_rig_cmd(%s): no pending command slots available", cmd_name);
        return NULL;
    }

    char msg[512];
    snprintf(msg, sizeof(msg),
             "{\"cmd\":\"%s\",\"args\":%s,\"id\":%d}",
             cmd_name, args_json, pc->id);

    VLOG("Sending to browser: %s", msg);
    if (ws_send_text(ws_client, msg) < 0) {
        VLOG("send_rig_cmd(%s): WebSocket send failed", cmd_name);
        pc->in_use = 0;
        return NULL;
    }
    return pc;
}

/* ─── Handle rigctld command from WSJTX ──────────────────────────────────── */

/*
 * Process one rigctld extended-mode command line.
 * Returns the response string to send back on the TCP socket.
 * For set commands, sends a WebSocket command and returns NULL
 * (response delivered asynchronously via pending_cmd).
 */
static const char *handle_rigctld_cmd(sock_t tcp_sock, const char *line) {
    static char resp[2048];

    /* Strip extended-mode prefix */
    const char *cmd = line;
    if (*cmd == '+') cmd++;
    if (*cmd == '\\') cmd++;

    /* Skip leading whitespace */
    while (*cmd == ' ') cmd++;

    if (cmd[0] == '\0') return NULL;

    VLOG("rigctld cmd: \"%s\"", cmd);

    /* ── GET commands (respond from cache) ── */

    if (cmd[0] == 'f' && (cmd[1] == '\0' || cmd[1] == ' ' || cmd[1] == '\n')) {
        snprintf(resp, sizeof(resp), "%s\n", rig_frequency);
        VLOG("  -> get_freq: %s", rig_frequency);
        return resp;
    }
    if (cmd[0] == 'm' && (cmd[1] == '\0' || cmd[1] == ' ' || cmd[1] == '\n')) {
        snprintf(resp, sizeof(resp), "%s\n%s\n", rig_mode, rig_bandwidth);
        VLOG("  -> get_mode: %s %s", rig_mode, rig_bandwidth);
        return resp;
    }
    if (cmd[0] == 't' && (cmd[1] == '\0' || cmd[1] == ' ' || cmd[1] == '\n')) {
        snprintf(resp, sizeof(resp), "%d\n", rig_ptt);
        VLOG("  -> get_ptt: %d", rig_ptt);
        return resp;
    }
    if (cmd[0] == 'v' && (cmd[1] == '\0' || cmd[1] == ' ' || cmd[1] == '\n')) {
        snprintf(resp, sizeof(resp), "%s\n", rig_vfo);
        VLOG("  -> get_vfo: %s", rig_vfo);
        return resp;
    }
    if (cmd[0] == 's' && (cmd[1] == '\0' || cmd[1] == ' ' || cmd[1] == '\n')) {
        snprintf(resp, sizeof(resp), "%d\n%s\n", rig_split, rig_tx_vfo);
        VLOG("  -> get_split: %d %s", rig_split, rig_tx_vfo);
        return resp;
    }
    if (cmd[0] == 'i' && (cmd[1] == '\0' || cmd[1] == ' ' || cmd[1] == '\n')) {
        snprintf(resp, sizeof(resp), "%s\n", rig_split_freq);
        VLOG("  -> get_split_freq: %s", rig_split_freq);
        return resp;
    }
    if (cmd[0] == 'x' && (cmd[1] == '\0' || cmd[1] == ' ' || cmd[1] == '\n')) {
        snprintf(resp, sizeof(resp), "%s\n%s\n", rig_split_mode, rig_split_bw);
        VLOG("  -> get_split_mode: %s %s", rig_split_mode, rig_split_bw);
        return resp;
    }

    /* ── SET commands (forward to browser) ── */

    if (cmd[0] == 'F' && cmd[1] == ' ') {
        char freq[32];
        if (sscanf(cmd + 2, "%31s", freq) == 1) {
            char args[64];
            snprintf(args, sizeof(args), "\"%s\"", freq);
            pending_cmd_t *pc = send_rig_cmd(tcp_sock, "set-frequency", args);
            if (pc) {
                snprintf(rig_frequency, sizeof(rig_frequency), "%s", freq);
#ifdef _WIN32
                freq_set_at = GetTickCount();
#else
                stamp_now(&freq_set_at);
#endif
                return NULL;
            }
        }
        return "RPRT -1\n";
    }

    if (cmd[0] == 'M' && cmd[1] == ' ') {
        char mode[32], bw[32];
        if (sscanf(cmd + 2, "%31s %31s", mode, bw) >= 1) {
            if (sscanf(cmd + 2, "%31s %31s", mode, bw) < 2)
                strcpy(bw, "-1");
            char args[128];
            snprintf(args, sizeof(args),
                     "{\"mode\":\"%s\",\"bandwidth\":\"%s\"}", mode, bw);
            pending_cmd_t *pc = send_rig_cmd(tcp_sock, "set-mode", args);
            if (pc) {
                snprintf(rig_mode, sizeof(rig_mode), "%s", mode);
#ifdef _WIN32
                mode_set_at = GetTickCount();
#else
                stamp_now(&mode_set_at);
#endif
                return NULL;
            }
        }
        return "RPRT -1\n";
    }

    if (cmd[0] == 'T' && cmd[1] == ' ') {
        int ptt = 0;
        if (sscanf(cmd + 2, "%d", &ptt) == 1) {
            VLOG("PTT command: T %d (requesting %s)", ptt, ptt ? "TX" : "RX");
            char args[16];
            snprintf(args, sizeof(args), "%d", ptt);
            pending_cmd_t *pc = send_rig_cmd(tcp_sock, "set-ptt", args);
            if (pc) {
                VLOG("PTT command queued as id=%d, awaiting browser response", pc->id);
                rig_ptt = ptt > 0 ? 1 : 0;
#ifdef _WIN32
                ptt_set_at = GetTickCount();
#else
                stamp_now(&ptt_set_at);
#endif
                return NULL;
            }
            VLOG("PTT command FAILED: could not queue (no WS client or no slot)");
        }
        return "RPRT -1\n";
    }

    if (cmd[0] == 'V' && cmd[1] == ' ') {
        char vfo[16];
        if (sscanf(cmd + 2, "%15s", vfo) == 1) {
            char args[32];
            snprintf(args, sizeof(args), "\"%s\"", vfo);
            pending_cmd_t *pc = send_rig_cmd(tcp_sock, "set-vfo", args);
            if (pc) return NULL;
        }
        return "RPRT -1\n";
    }

    if (cmd[0] == 'S' && cmd[1] == ' ') {
        int split = 0;
        char vfo[16] = "VFOB";
        sscanf(cmd + 2, "%d %15s", &split, vfo);
        char args[64];
        snprintf(args, sizeof(args),
                 "{\"split\":%d,\"vfo\":\"%s\"}", split, vfo);
        pending_cmd_t *pc = send_rig_cmd(tcp_sock, "set-split-vfo", args);
        if (pc) return NULL;
        return "RPRT -1\n";
    }

    if (cmd[0] == 'I' && cmd[1] == ' ') {
        char freq[32];
        if (sscanf(cmd + 2, "%31s", freq) == 1) {
            char args[64];
            snprintf(args, sizeof(args), "\"I %s\"", freq);
            pending_cmd_t *pc = send_rig_cmd(tcp_sock, "send-raw", args);
            if (pc) {
                snprintf(rig_split_freq, sizeof(rig_split_freq), "%s", freq);
                return NULL;
            }
        }
        return "RPRT -1\n";
    }

    if (cmd[0] == 'X' && cmd[1] == ' ') {
        char mode[32], bw[32];
        if (sscanf(cmd + 2, "%31s %31s", mode, bw) >= 1) {
            if (sscanf(cmd + 2, "%31s %31s", mode, bw) < 2)
                strcpy(bw, "-1");
            char args[128];
            snprintf(args, sizeof(args), "\"X %s %s\"", mode, bw);
            pending_cmd_t *pc = send_rig_cmd(tcp_sock, "send-raw", args);
            if (pc) {
                snprintf(rig_split_mode, sizeof(rig_split_mode), "%s", mode);
                snprintf(rig_split_bw, sizeof(rig_split_bw), "%s", bw);
                return NULL;
            }
        }
        return "RPRT -1\n";
    }

    /*
     * ── dump_state — rigctld NET protocol initialization ──
     *
     * WSJTX (via Hamlib's netrigctl backend) sends \dump_state on connect.
     * The response is a structured multi-line format defined by rigctld's
     * dumpcaps_protocol() in rigctl_parse.c.  The fields are parsed by
     * netrigctl_open() in rigs/dummy/netrigctl.c.
     *
     * Protocol version 1 extends version 0 with a key=value section
     * (terminated by "done") that declares per-capability flags.  The
     * critical field is ptt_type: without it the netrigctl backend defaults
     * to RIG_PTT_NONE and WSJTX will never send T commands.
     */

    if (strncmp(cmd, "dump_state", 10) == 0) {
        VLOG("  -> dump_state (rigctld NET init, protocol v1)");
        snprintf(resp, sizeof(resp),
            "1\n"                             /* protocol version 1 */
            "2\n"                             /* rig model 2 = NET rigctl */
            "2\n"                             /* ITU region */
            /* RX range: 30 kHz – 470 MHz, all common modes, VFO A+B */
            "30000 470000000 0x1fff -1 -1 0x3 0x0\n"
            "0 0 0 0 0 0 0\n"                 /* RX terminator */
            /* TX range: same */
            "30000 470000000 0x1fff 1 100 0x3 0x0\n"
            "0 0 0 0 0 0 0\n"                 /* TX terminator */
            /* Tuning steps: all modes, 1 Hz */
            "0x1fff 1\n"
            "0 0\n"                           /* steps terminator */
            /* Filters: all modes, any width */
            "0x1fff 0\n"
            "0 0\n"                           /* filters terminator */
            "0\n"                             /* max RIT */
            "0\n"                             /* max XIT */
            "0\n"                             /* max IF shift */
            "0\n"                             /* announces */
            "\n"                              /* preamp list (empty) */
            "\n"                              /* attenuator list (empty) */
            "0x0\n"                           /* has_get_func */
            "0x0\n"                           /* has_set_func */
            "0x0\n"                           /* has_get_level */
            "0x0\n"                           /* has_set_level */
            "0x0\n"                           /* has_get_parm */
            "0x0\n"                           /* has_set_parm */
            /* ── Protocol v1 key=value section ── */
            "ptt_type=0x1\n"                  /* RIG_PTT_RIG (CAT PTT) */
            "has_set_freq=1\n"
            "has_get_freq=1\n"
            "has_set_mode=1\n"
            "has_get_mode=1\n"
            "has_set_vfo=1\n"
            "has_get_vfo=1\n"
            "done\n"
        );
        return resp;
    }

    /* dump_caps — human-readable form (not used by WSJTX, but useful for diag) */
    if (strncmp(cmd, "dump_caps", 9) == 0 || strncmp(cmd, "1", 1) == 0) {
        snprintf(resp, sizeof(resp),
            "Caps dump for model: 2\n"
            "Model name: RCW WSJTX Bridge\n"
            "Mfg name: RigControl Web\n"
            "Backend version: 1.0\n"
            "RPRT 0\n");
        return resp;
    }

    /* ── chk_vfo — WSJTX sends this before dump_state ── */

    if (strncmp(cmd, "chk_vfo", 7) == 0) {
        VLOG("  -> chk_vfo: returning CHKVFO 0 (no VFO targeting)");
        return "CHKVFO 0\n";
    }

    /* ── get_powerstat — always return ON ── */

    if (strncmp(cmd, "get_powerstat", 13) == 0) {
        VLOG("  -> get_powerstat: 1 (ON)");
        return "1\n";
    }

    /* ── lock_mode — WSJTX checks if mode changes are allowed ── */

    if (strncmp(cmd, "get_lock_mode", 13) == 0) {
        VLOG("  -> get_lock_mode: 0 (unlocked)");
        return "0\n";
    }

    if (strncmp(cmd, "set_lock_mode", 13) == 0) {
        VLOG("  -> set_lock_mode: accepted (no-op)");
        return "RPRT 0\n";
    }

    /* ── RIT/XIT — WSJTX queries these; always report zero offset ── */

    if (strncmp(cmd, "get_rit", 7) == 0) {
        VLOG("  -> get_rit: 0");
        return "0\n";
    }

    if (strncmp(cmd, "set_rit", 7) == 0) {
        VLOG("  -> set_rit: accepted (no-op)");
        return "RPRT 0\n";
    }

    if (strncmp(cmd, "get_xit", 7) == 0) {
        VLOG("  -> get_xit: 0");
        return "0\n";
    }

    if (strncmp(cmd, "set_xit", 7) == 0) {
        VLOG("  -> set_xit: accepted (no-op)");
        return "RPRT 0\n";
    }

    /* ── q (quit) — WSJTX sends before disconnecting ── */

    if (cmd[0] == 'q' && (cmd[1] == '\0' || cmd[1] == ' ' || cmd[1] == '\n')) {
        VLOG("  -> quit");
        g_close_after_cmd = tcp_sock;
        return NULL;
    }

    /* ── Unknown command ── */

    VLOG("  -> UNKNOWN, returning RPRT -1");
    return "RPRT -1\n";
}

/* ─── TCP client state ───────────────────────────────────────────────────── */

typedef struct {
    sock_t sock;
    char   buf[TCP_BUF_SIZE];
    int    buf_len;
} tcp_client_t;

static tcp_client_t tcp_clients[MAX_TCP_CLIENTS];
static int num_tcp_clients = 0;

static void tcp_client_remove(int idx) {
    CLOSESOCK(tcp_clients[idx].sock);
    /* Clear any pending commands for this client */
    for (int i = 0; i < MAX_PENDING_CMDS; i++) {
        if (pending_cmds[i].in_use && pending_cmds[i].tcp_sock == tcp_clients[idx].sock) {
            pending_cmds[i].in_use = 0;
        }
    }
    tcp_clients[idx] = tcp_clients[--num_tcp_clients];
}

/* ─── WebSocket client state ─────────────────────────────────────────────── */

static unsigned char ws_buf[WS_BUF_SIZE];
static int ws_buf_len = 0;
static int ws_handshake_done = 0;

static void ws_client_reset(void) {
    if (ws_client != SOCK_INVALID) CLOSESOCK(ws_client);
    ws_client = SOCK_INVALID;
    ws_buf_len = 0;
    ws_handshake_done = 0;
}

/* ─── PipeWire virtual audio (Linux only) ────────────────────────────────── */

#if !defined(_WIN32) && !defined(__APPLE__)
#include <sys/wait.h>
#ifdef __linux__
#include <sys/prctl.h>
#endif

static pid_t pw_rx_pid = 0;   /* pw-loopback for RX (browser → WSJTX) */
static pid_t pw_tx_pid = 0;   /* pw-loopback for TX (WSJTX → browser) */

static void kill_pw_children(void) {
    if (pw_rx_pid > 0) { kill(pw_rx_pid, SIGTERM); waitpid(pw_rx_pid, NULL, 0); pw_rx_pid = 0; }
    if (pw_tx_pid > 0) { kill(pw_tx_pid, SIGTERM); waitpid(pw_tx_pid, NULL, 0); pw_tx_pid = 0; }
}

static pid_t spawn_pw_loopback(const char *node_name, const char *description,
                                const char *media_class, const char *capture_class) {
    pid_t pid = fork();
    if (pid < 0) return -1;
    if (pid == 0) {
        /* child — auto-terminate if parent dies */
#ifdef __linux__
        prctl(PR_SET_PDEATHSIG, SIGTERM);
#endif
        char capture_props[256];
        char playback_props[256];
        snprintf(capture_props, sizeof(capture_props),
                 "node.name=%s node.description=%s media.class=%s",
                 node_name, description, capture_class);
        snprintf(playback_props, sizeof(playback_props),
                 "node.name=%s.output node.description=%s media.class=%s",
                 node_name, description, media_class);
        execlp("pw-loopback", "pw-loopback",
               "--channels", "1",
               "--channel-map", "MONO",
               "--capture-props", capture_props,
               "--playback-props", playback_props,
               (char *)NULL);
        /* exec failed */
        _exit(127);
    }
    return pid;
}

static int check_pw_loopback(void) {
    pid_t pid = fork();
    if (pid < 0) return 0;
    if (pid == 0) {
        /* Redirect stdout/stderr to /dev/null */
        freopen("/dev/null", "w", stdout);
        freopen("/dev/null", "w", stderr);
        execlp("pw-loopback", "pw-loopback", "--help", (char *)NULL);
        _exit(127);
    }
    int status;
    waitpid(pid, &status, 0);
    return WIFEXITED(status) && WEXITSTATUS(status) != 127;
}

static int start_virtual_audio(void) {
    if (!check_pw_loopback()) {
        fprintf(stderr, "wsjtx-bridge: pw-loopback not found. Install pipewire for virtual audio.\n");
        fprintf(stderr, "wsjtx-bridge: Use --no-audio to skip virtual audio setup.\n");
        return -1;
    }

    VLOG("Spawning pw-loopback for RX virtual sink (browser -> WSJTX)");
    pw_rx_pid = spawn_pw_loopback(
        "rcw_wsjtx_rx", "RCW-WSJTX-RX",
        "Audio/Source", "Audio/Sink");
    if (pw_rx_pid < 0) {
        fprintf(stderr, "wsjtx-bridge: Failed to spawn pw-loopback for RX\n");
        return -1;
    }
    VLOG("RX pw-loopback PID: %d", (int)pw_rx_pid);

    VLOG("Spawning pw-loopback for TX virtual sink (WSJTX -> browser)");
    pw_tx_pid = spawn_pw_loopback(
        "rcw_wsjtx_tx", "RCW-WSJTX-TX",
        "Audio/Source", "Audio/Sink");
    if (pw_tx_pid < 0) {
        fprintf(stderr, "wsjtx-bridge: Failed to spawn pw-loopback for TX\n");
        kill(pw_rx_pid, SIGTERM); waitpid(pw_rx_pid, NULL, 0); pw_rx_pid = 0;
        return -1;
    }
    VLOG("TX pw-loopback PID: %d", (int)pw_tx_pid);

    /* Brief pause to let PipeWire register the devices */
    usleep(200000);

    fprintf(stderr, "wsjtx-bridge: Virtual audio devices created (PipeWire)\n");
    fprintf(stderr, "  WSJTX Soundcard Input:   RCW-WSJTX-RX\n");
    fprintf(stderr, "  WSJTX Soundcard Output:  RCW-WSJTX-TX\n");
    fprintf(stderr, "  RCW WSJTX Audio Output:  RCW-WSJTX-RX\n");
    fprintf(stderr, "  RCW Local Input (Mic):   RCW-WSJTX-TX\n");
    return 0;
}

static void stop_virtual_audio(void) {
    if (pw_rx_pid > 0 || pw_tx_pid > 0) {
        VLOG("Stopping virtual audio devices");
        kill_pw_children();
        fprintf(stderr, "wsjtx-bridge: Virtual audio devices removed\n");
    }
}

#endif /* !_WIN32 && !__APPLE__ */

/* ─── Cleanup at exit ────────────────────────────────────────────────────── */

static void cleanup_at_exit(void) {
#if !defined(_WIN32) && !defined(__APPLE__)
    stop_virtual_audio();
#endif
}

/* ─── Main event loop ────────────────────────────────────────────────────── */

int main(int argc, char *argv[]) {
    int tcp_port = 4540;
    int ws_port  = 4541;
    int setup_audio = 1;   /* auto-create virtual audio on Linux */

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--tcp-port") == 0 && i+1 < argc)
            tcp_port = atoi(argv[++i]);
        else if (strcmp(argv[i], "--ws-port") == 0 && i+1 < argc)
            ws_port = atoi(argv[++i]);
        else if (strcmp(argv[i], "--verbose") == 0 || strcmp(argv[i], "-v") == 0)
            verbose = 1;
        else if (strcmp(argv[i], "--no-audio") == 0)
            setup_audio = 0;
        else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            printf("Usage: wsjtx-bridge [OPTIONS]\n\n");
            printf("Options:\n");
            printf("  --tcp-port N  rigctld protocol port for WSJTX (default 4540)\n");
            printf("  --ws-port N   WebSocket port for RigControl Web browser (default 4541)\n");
            printf("  --no-audio    Skip automatic virtual audio device creation (Linux)\n");
            printf("  --verbose,-v  Log all rigctld commands, WebSocket messages, and state changes\n");
            printf("  --help,-h     Show this help message\n");
#if !defined(_WIN32) && !defined(__APPLE__)
            printf("\nOn Linux, virtual audio devices are created automatically via pw-loopback\n");
            printf("(PipeWire) on startup and removed on exit. Use --no-audio to disable.\n");
#endif
            return 0;
        }
    }

    sock_init();
    atexit(cleanup_at_exit);
    memset(tcp_clients, 0, sizeof(tcp_clients));
    memset(pending_cmds, 0, sizeof(pending_cmds));

    sock_t tcp_listen = make_listen_socket(tcp_port);
    if (tcp_listen == SOCK_INVALID) {
        fprintf(stderr, "ERROR: Cannot bind TCP port %d\n", tcp_port);
        return 1;
    }

    sock_t ws_listen = make_listen_socket(ws_port);
    if (ws_listen == SOCK_INVALID) {
        fprintf(stderr, "ERROR: Cannot bind WebSocket port %d\n", ws_port);
        CLOSESOCK(tcp_listen);
        return 1;
    }

    printf("READY %d %d\n", tcp_port, ws_port);
    fflush(stdout);
    fprintf(stderr, "wsjtx-bridge v0.2.3: TCP (rigctld) on localhost:%d, WebSocket on localhost:%d\n",
            tcp_port, ws_port);

#if !defined(_WIN32) && !defined(__APPLE__)
    if (setup_audio) {
        if (start_virtual_audio() < 0) {
            fprintf(stderr, "wsjtx-bridge: Continuing without virtual audio devices.\n");
        }
    }
#else
    (void)setup_audio;
#endif

    while (g_running) {
        fd_set rfds;
        FD_ZERO(&rfds);
        FD_SET(tcp_listen, &rfds);
        FD_SET(ws_listen, &rfds);
        sock_t maxfd = tcp_listen > ws_listen ? tcp_listen : ws_listen;

        for (int i = 0; i < num_tcp_clients; i++) {
            FD_SET(tcp_clients[i].sock, &rfds);
            if (tcp_clients[i].sock > maxfd) maxfd = tcp_clients[i].sock;
        }
        if (ws_client != SOCK_INVALID) {
            FD_SET(ws_client, &rfds);
            if (ws_client > maxfd) maxfd = ws_client;
        }

        struct timeval tv = { 0, 100000 }; /* 100ms */
        int ready = select((int)(maxfd + 1), &rfds, NULL, NULL, &tv);
        if (ready < 0) {
#ifdef _WIN32
            if (SOCKERR == WSAEINTR) continue;
#else
            if (errno == EINTR) continue;
#endif
            break;
        }

        /* ── Accept new TCP client (WSJTX) ── */

        if (FD_ISSET(tcp_listen, &rfds)) {
            sock_t cs = accept(tcp_listen, NULL, NULL);
            if (cs != SOCK_INVALID) {
                if (num_tcp_clients < MAX_TCP_CLIENTS) {
                    tcp_clients[num_tcp_clients].sock = cs;
                    tcp_clients[num_tcp_clients].buf_len = 0;
                    num_tcp_clients++;
                    fprintf(stderr, "wsjtx-bridge: WSJTX connected (TCP)\n");
                    VLOG("TCP client accepted, total clients: %d", num_tcp_clients);
                } else {
                    CLOSESOCK(cs);
                    VLOG("TCP client rejected, max clients (%d) reached", MAX_TCP_CLIENTS);
                }
            }
        }

        /* ── Accept new WebSocket client (browser) ── */

        if (FD_ISSET(ws_listen, &rfds)) {
            sock_t cs = accept(ws_listen, NULL, NULL);
            if (cs != SOCK_INVALID) {
                if (ws_client != SOCK_INVALID) {
                    /* Replace existing connection */
                    ws_client_reset();
                }
                ws_client = cs;
                ws_buf_len = 0;
                ws_handshake_done = 0;
                fprintf(stderr, "wsjtx-bridge: Browser connected (WebSocket)\n");
            }
        }

        /* ── Read from TCP clients ── */

        for (int i = 0; i < num_tcp_clients; i++) {
            if (!FD_ISSET(tcp_clients[i].sock, &rfds)) continue;

            int space = TCP_BUF_SIZE - tcp_clients[i].buf_len - 1;
            if (space <= 0) { tcp_clients[i].buf_len = 0; continue; }

            int n = recv(tcp_clients[i].sock, tcp_clients[i].buf + tcp_clients[i].buf_len, space, 0);
            if (n <= 0) {
                fprintf(stderr, "wsjtx-bridge: WSJTX disconnected (TCP)\n");
                VLOG("TCP client disconnected, remaining clients: %d", num_tcp_clients - 1);
                tcp_client_remove(i);
                i--;
                continue;
            }
            tcp_clients[i].buf_len += n;
            tcp_clients[i].buf[tcp_clients[i].buf_len] = '\0';

            /* Process complete lines */
            char *start = tcp_clients[i].buf;
            char *nl;
            int client_closed = 0;
            while ((nl = strchr(start, '\n')) != NULL) {
                *nl = '\0';
                /* Trim \r */
                if (nl > start && *(nl-1) == '\r') *(nl-1) = '\0';

                const char *response = handle_rigctld_cmd(tcp_clients[i].sock, start);
                if (response) {
                    send_str(tcp_clients[i].sock, response);
                }
                /* If response is NULL, it's async (pending_cmd will deliver) */

                start = nl + 1;

                /* 'q' handler sets g_close_after_cmd — close immediately so WSJTX
                 * sees EOF without waiting for its own timeout (~20 s). */
                if (g_close_after_cmd == tcp_clients[i].sock) {
                    g_close_after_cmd = SOCK_INVALID;
                    tcp_client_remove(i);
                    i--;
                    client_closed = 1;
                    break;
                }
            }
            if (client_closed) continue;

            /* Shift remaining data */
            int remaining = tcp_clients[i].buf_len - (int)(start - tcp_clients[i].buf);
            if (remaining > 0)
                memmove(tcp_clients[i].buf, start, remaining);
            tcp_clients[i].buf_len = remaining;
        }

        /* ── Read from WebSocket client ── */

        if (ws_client != SOCK_INVALID && FD_ISSET(ws_client, &rfds)) {
            int space = WS_BUF_SIZE - ws_buf_len - 1; /* reserve 1 byte for the NUL terminator written below */
            if (space <= 0) { ws_client_reset(); goto ws_done; }

            int n = recv(ws_client, (char*)(ws_buf + ws_buf_len), space, 0);
            if (n <= 0) {
                fprintf(stderr, "wsjtx-bridge: Browser disconnected (WebSocket)\n");
                ws_client_reset();
                goto ws_done;
            }
            ws_buf_len += n;

            if (!ws_handshake_done) {
                /* Look for end of HTTP request */
                ws_buf[ws_buf_len] = '\0';
                if (strstr((char*)ws_buf, "\r\n\r\n")) {
                    if (ws_do_handshake(ws_client, (char*)ws_buf) < 0) {
                        fprintf(stderr, "wsjtx-bridge: WebSocket handshake failed\n");
                        ws_client_reset();
                    } else {
                        ws_handshake_done = 1;
                        ws_buf_len = 0;
                        fprintf(stderr, "wsjtx-bridge: WebSocket handshake complete\n");
                        VLOG("WebSocket handshake complete, ready for messages");
                    }
                }
                goto ws_done;
            }

            /* Decode WebSocket frames */
            for (;;) {
                char payload[WS_BUF_SIZE];
                int payload_len = 0;
                int is_close = 0;
                int consumed = ws_decode_frame(ws_buf, ws_buf_len,
                                               payload, sizeof(payload),
                                               &payload_len, &is_close);
                if (consumed <= 0) break;

                if (is_close) {
                    fprintf(stderr, "wsjtx-bridge: Browser sent close frame\n");
                    ws_client_reset();
                    break;
                }

                if (payload_len > 0) {
                    VLOG("WS received (%d bytes): %.*s", payload_len, payload_len > 200 ? 200 : payload_len, payload);
                    handle_ws_message(payload);
                }

                /* Shift buffer */
                ws_buf_len -= consumed;
                if (ws_buf_len > 0)
                    memmove(ws_buf, ws_buf + consumed, ws_buf_len);
            }
        }
        ws_done:

        /* ── Deliver pending command responses to TCP clients ── */

        expire_cmds();
        for (int i = 0; i < MAX_PENDING_CMDS; i++) {
            if (!pending_cmds[i].in_use || !pending_cmds[i].responded) continue;
            /* Find the TCP client and send the response */
            int delivered = 0;
            for (int j = 0; j < num_tcp_clients; j++) {
                if (tcp_clients[j].sock == pending_cmds[i].tcp_sock) {
                    VLOG("Delivering response id=%d to TCP client (%d ms round-trip): %s",
                         pending_cmds[i].id, ms_elapsed(&pending_cmds[i]),
                         pending_cmds[i].response);
                    send_str(tcp_clients[j].sock, pending_cmds[i].response);
                    delivered = 1;
                    break;
                }
            }
            if (!delivered) {
                VLOG("Dropping response id=%d, TCP client gone", pending_cmds[i].id);
            }
            pending_cmds[i].in_use = 0;
        }
    }

    CLOSESOCK(tcp_listen);
    CLOSESOCK(ws_listen);
    ws_client_reset();
#if !defined(_WIN32) && !defined(__APPLE__)
    stop_virtual_audio();
#endif
    return 0;
}

/*
 * cw-key-helper.c — CW keyer serial line helper for RigControl Web.
 * Spawned by server/cw.ts; controls DTR or RTS via direct OS calls.
 * Replaces cw-key-helper.py; eliminates the Python/pyserial dependency.
 *
 * Usage: cw-key-helper <port_path> <dtr|rts> <high|low>
 * stdin:  "1\n" -> key active   "0\n" -> key inactive
 * stdout: "OPEN_OK\n" on success, "OPEN_ERROR: <msg>\n" on failure
 *
 * Build:
 *   Linux:   gcc -O2 -static -o bin/linux/cw-key-helper cw-key-helper.c
 *   macOS:   clang -O2 -o bin/mac/cw-key-helper cw-key-helper.c
 *   Windows: cl cw-key-helper.c /Fe:bin\windows\cw-key-helper.exe /O2 /nologo
 */

#ifdef _WIN32

#include <windows.h>
#include <stdio.h>
#include <string.h>

static HANDLE g_handle = INVALID_HANDLE_VALUE;
static int g_rts;
static int g_active_high;

static void set_line(int active) {
    int level = active ? g_active_high : !g_active_high;
    BOOL ok;
    if (g_rts)
        ok = EscapeCommFunction(g_handle, level ? SETRTS : CLRRTS);
    else
        ok = EscapeCommFunction(g_handle, level ? SETDTR : CLRDTR);
    if (!ok) {
        /* A failed toggle (stale handle, device unplugged) would otherwise be silently
         * swallowed — the process keeps reading stdin as if keying still works. Report it
         * on stdout, matching the existing OPEN_OK/OPEN_ERROR protocol convention, so the
         * parent process can detect and surface it instead of assuming success. */
        printf("KEY_ERROR: EscapeCommFunction failed (error %lu)\n", (unsigned long)GetLastError());
        fflush(stdout);
    }
}

static void cleanup(void) {
    if (g_handle != INVALID_HANDLE_VALUE) {
        set_line(0);
        CloseHandle(g_handle);
        g_handle = INVALID_HANDLE_VALUE;
    }
}

int main(int argc, char *argv[]) {
    if (argc < 4) {
        printf("OPEN_ERROR: usage: cw-key-helper <port> <dtr|rts> <high|low>\n");
        fflush(stdout);
        return 1;
    }

    const char *port_arg = argv[1];
    g_rts        = (strcmp(argv[2], "rts") == 0);
    g_active_high = (strcmp(argv[3], "high") == 0);

    /* Ports above COM9 require the \\.\COMn prefix; apply it universally. */
    char portbuf[64];
    if (strncmp(port_arg, "\\\\.\\", 4) != 0) {
        snprintf(portbuf, sizeof(portbuf), "\\\\.\\%s", port_arg);
        port_arg = portbuf;
    }

    g_handle = CreateFileA(port_arg,
        GENERIC_READ | GENERIC_WRITE,
        0, NULL, OPEN_EXISTING, 0, NULL);
    if (g_handle == INVALID_HANDLE_VALUE) {
        printf("OPEN_ERROR: CreateFile failed (error %lu)\n", (unsigned long)GetLastError());
        fflush(stdout);
        return 1;
    }

    DCB dcb;
    memset(&dcb, 0, sizeof(dcb));
    dcb.DCBlength = sizeof(dcb);
    if (!GetCommState(g_handle, &dcb)) {
        printf("OPEN_ERROR: GetCommState failed\n");
        fflush(stdout);
        CloseHandle(g_handle);
        return 1;
    }
    dcb.fDtrControl  = DTR_CONTROL_DISABLE;
    dcb.fRtsControl  = RTS_CONTROL_DISABLE;
    dcb.fOutxCtsFlow = FALSE;
    dcb.fOutxDsrFlow = FALSE;
    if (!SetCommState(g_handle, &dcb)) {
        printf("OPEN_ERROR: SetCommState failed\n");
        fflush(stdout);
        CloseHandle(g_handle);
        return 1;
    }

    /* Explicitly deassert the controlled line before reporting success. */
    set_line(0);
    atexit(cleanup);

    printf("OPEN_OK\n");
    fflush(stdout);

    int c;
    while ((c = getchar()) != EOF) {
        if (c == '1') set_line(1);
        else if (c == '0') set_line(0);
    }
    return 0;
}

#else /* POSIX: Linux and macOS */

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <unistd.h>

static int g_fd = -1;
static int g_rts;
static int g_active_high;

static void set_line(int active) {
    int level = active ? g_active_high : !g_active_high;
    int flag  = g_rts ? TIOCM_RTS : TIOCM_DTR;
    if (ioctl(g_fd, level ? TIOCMBIS : TIOCMBIC, &flag) < 0) {
        /* A failed toggle (unplugged/wedged adapter, invalid fd) would otherwise be silently
         * swallowed — the process keeps reading stdin as if keying still works. Report it on
         * stdout, matching the existing OPEN_OK/OPEN_ERROR protocol convention, so the parent
         * process can detect and surface it instead of assuming success. */
        printf("KEY_ERROR: ioctl: %s\n", strerror(errno));
        fflush(stdout);
    }
}

static void cleanup(void) {
    if (g_fd >= 0) {
        set_line(0);
        close(g_fd);
        g_fd = -1;
    }
}

static void sig_handler(int sig) {
    (void)sig;
    cleanup();
    _exit(0);
}

int main(int argc, char *argv[]) {
    if (argc < 4) {
        printf("OPEN_ERROR: usage: cw-key-helper <port> <dtr|rts> <high|low>\n");
        fflush(stdout);
        return 1;
    }

    const char *port_path = argv[1];
    g_rts        = (strcmp(argv[2], "rts") == 0);
    g_active_high = (strcmp(argv[3], "high") == 0);

    /*
     * O_NOCTTY: don't become the controlling terminal.
     * O_NONBLOCK: prevent open() from blocking on carrier-detect.
     * Both flags mirror pyserial's serialposix.py open() call, which is what
     * allows pyserial to avoid asserting DTR on open (unlike the Node.js
     * serialport npm package's C++ bindings).
     */
    g_fd = open(port_path, O_RDWR | O_NOCTTY | O_NONBLOCK);
    if (g_fd < 0) {
        printf("OPEN_ERROR: %s\n", strerror(errno));
        fflush(stdout);
        return 1;
    }

    struct termios tty;
    if (tcgetattr(g_fd, &tty) < 0) {
        printf("OPEN_ERROR: tcgetattr: %s\n", strerror(errno));
        fflush(stdout);
        close(g_fd);
        return 1;
    }

    /*
     * We only need modem control line access, not data I/O. Touch only
     * the three flags that affect DTR/RTS toggling; leave baud rate and
     * data framing exactly as-is so we don't disrupt any other process
     * (e.g. rigctld) that may have the same port open.
     *
     * CRTSCTS: if set, the kernel owns RTS for flow control — must be off.
     * HUPCL:   if set, DTR/RTS drop when the last fd closes — must be off.
     * CLOCAL:  ignores modem status lines; prevents blocking on DCD.
     */
#ifdef CRTSCTS
    tty.c_cflag &= ~CRTSCTS;
#endif
    tty.c_cflag &= ~HUPCL;
    tty.c_cflag |= CLOCAL | CREAD;

    if (tcsetattr(g_fd, TCSANOW, &tty) < 0) {
        printf("OPEN_ERROR: tcsetattr: %s\n", strerror(errno));
        fflush(stdout);
        close(g_fd);
        return 1;
    }

    /* Remove O_NONBLOCK from the port fd now that open() has completed. */
    int flags = fcntl(g_fd, F_GETFL, 0);
    fcntl(g_fd, F_SETFL, flags & ~O_NONBLOCK);

    /* Explicitly deassert the controlled line before reporting success. */
    set_line(0);

    signal(SIGTERM, sig_handler);
    signal(SIGINT,  sig_handler);
    signal(SIGHUP,  sig_handler);
    signal(SIGPIPE, sig_handler);
    atexit(cleanup);

    printf("OPEN_OK\n");
    fflush(stdout);

    int c;
    while ((c = getchar()) != EOF) {
        if (c == '1') set_line(1);
        else if (c == '0') set_line(0);
    }
    return 0;
}

#endif /* _WIN32 */

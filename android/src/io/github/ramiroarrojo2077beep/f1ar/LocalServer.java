package io.github.ramiroarrojo2077beep.f1ar;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * Servidor HTTP mínimo que sirve los archivos del juego solo en 127.0.0.1.
 *
 * Chrome considera "seguro" a http://127.0.0.1, así que desde ahí el juego puede
 * usar WebXR (realidad aumentada) y service workers, sin depender de internet.
 * No usa nada de Android para poder probarse también en una JVM común.
 */
public final class LocalServer {

    /** De dónde salen los archivos ("www/index.html", "www/js/main.js", ...). */
    public interface Source {
        InputStream open(String path) throws IOException;
    }

    private static final int MAX_HEADER_BYTES = 16 * 1024;
    /** Ningún pedido puede ocupar un hilo más que esto (lectura + escritura). */
    private static final long REQUEST_DEADLINE_MS = 20000;

    private final Source source;
    private ServerSocket serverSocket;
    private ThreadPoolExecutor pool;
    private ScheduledThreadPoolExecutor watchdog;
    private volatile boolean running;

    public LocalServer(Source source) {
        this.source = source;
    }

    /** Arranca (si no estaba andando) y devuelve el puerto. Prueba varios puertos seguidos. */
    public synchronized int start(int firstPort, int attempts) throws IOException {
        if (running && serverSocket != null && !serverSocket.isClosed()) return serverSocket.getLocalPort();
        IOException last = null;
        ServerSocket bound = null;
        InetAddress loopback = InetAddress.getByName("127.0.0.1");
        for (int i = 0; i < attempts && bound == null; i++) {
            ServerSocket ss = new ServerSocket();
            try {
                ss.setReuseAddress(true);
                ss.bind(new InetSocketAddress(loopback, firstPort + i), 64);
                bound = ss;
            } catch (IOException e) {
                last = e;
                try { ss.close(); } catch (IOException ignored) { }
            }
        }
        if (bound == null) throw last != null ? last : new IOException("No hay puertos libres");
        serverSocket = bound;
        running = true;
        ThreadFactory daemons = new ThreadFactory() {
            private int n = 0;
            @Override public synchronized Thread newThread(Runnable r) {
                Thread t = new Thread(r, "f1ar-http-" + (n++));
                t.setDaemon(true);
                return t;
            }
        };
        // hilos a demanda (máx. 32); si se llenan, se rechaza la conexión en vez de encolarla
        pool = new ThreadPoolExecutor(2, 32, 30, TimeUnit.SECONDS, new SynchronousQueue<Runnable>(), daemons);
        watchdog = new ScheduledThreadPoolExecutor(1, daemons);
        watchdog.setRemoveOnCancelPolicy(true);
        final ServerSocket ss = bound;
        Thread acceptor = new Thread(new Runnable() {
            @Override public void run() { acceptLoop(ss); }
        }, "f1ar-http-accept");
        acceptor.setDaemon(true);
        acceptor.start();
        return ss.getLocalPort();
    }

    public synchronized boolean isRunning() {
        return running && serverSocket != null && !serverSocket.isClosed();
    }

    public synchronized int port() {
        return isRunning() ? serverSocket.getLocalPort() : -1;
    }

    public synchronized void stop() {
        running = false;
        if (serverSocket != null) {
            try { serverSocket.close(); } catch (IOException ignored) { }
            serverSocket = null;
        }
        if (pool != null) {
            pool.shutdownNow();
            pool = null;
        }
        if (watchdog != null) {
            watchdog.shutdownNow();
            watchdog = null;
        }
    }

    private void acceptLoop(ServerSocket ss) {
        while (running && !ss.isClosed()) {
            Socket accepted = null;
            try {
                accepted = ss.accept();
                final Socket client = accepted;
                ThreadPoolExecutor p = pool;
                if (p == null) { client.close(); break; }
                p.execute(new Runnable() {
                    @Override public void run() { handle(client); }
                });
            } catch (IOException e) {
                if (!running || ss.isClosed()) break;
            } catch (RejectedExecutionException e) {
                // demasiadas conexiones a la vez (o el pool se cerró): cortar esta
                closeQuietly(accepted);
                if (!running) break;
            }
        }
    }

    void handle(final Socket client) {
        ScheduledFuture<?> deadline = null;
        ScheduledThreadPoolExecutor w = watchdog;
        if (w != null) {
            try {
                deadline = w.schedule(new Runnable() {
                    @Override public void run() { closeQuietly(client); }
                }, REQUEST_DEADLINE_MS, TimeUnit.MILLISECONDS);
            } catch (RejectedExecutionException ignored) { }
        }
        try {
            client.setSoTimeout(8000);
            InputStream in = new BufferedInputStream(client.getInputStream());
            OutputStream out = client.getOutputStream();
            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) return;
            // descartar los encabezados (no los necesitamos)
            int headerBytes = 0;
            while (true) {
                String h = readLine(in);
                if (h == null || h.isEmpty()) break;
                headerBytes += h.length();
                if (headerBytes > MAX_HEADER_BYTES) { send(out, 431, "text/plain; charset=utf-8", bytes("Encabezados muy grandes"), false); return; }
            }
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) { send(out, 400, "text/plain; charset=utf-8", bytes("Pedido inválido"), false); return; }
            String method = parts[0];
            boolean head = "HEAD".equals(method);
            if (!"GET".equals(method) && !head) {
                send(out, 405, "text/plain; charset=utf-8", bytes("Método no permitido"), false);
                return;
            }
            String path = resolve(parts[1]);
            if (path == null) { send(out, 400, "text/plain; charset=utf-8", bytes("Ruta inválida"), head); return; }
            byte[] body;
            InputStream is = null;
            try {
                is = source.open(path);
                body = readAll(is);
            } catch (FileNotFoundException e) {
                send(out, 404, "text/plain; charset=utf-8", bytes("No encontrado"), head);
                return;
            } finally {
                if (is != null) try { is.close(); } catch (IOException ignored) { }
            }
            send(out, 200, contentType(path), body, head);
        } catch (IOException ignored) {
            // el navegador cortó la conexión (o venció el plazo): no pasa nada
        } finally {
            if (deadline != null) deadline.cancel(false);
            closeQuietly(client);
        }
    }

    private static void closeQuietly(Socket s) {
        if (s == null) return;
        try { s.close(); } catch (IOException ignored) { }
    }

    /** "/js/main.js?v=2" -> "www/js/main.js"; null si la ruta no es válida. */
    static String resolve(String target) {
        if (target == null) return null;
        int cut = target.length();
        int q = target.indexOf('?');
        if (q >= 0) cut = Math.min(cut, q);
        int f = target.indexOf('#');
        if (f >= 0) cut = Math.min(cut, f);
        String raw = target.substring(0, cut);
        if (!raw.startsWith("/")) return null;
        String decoded = percentDecode(raw);
        if (decoded == null || decoded.indexOf('\0') >= 0 || decoded.indexOf('\\') >= 0) return null;
        if (decoded.endsWith("/")) decoded = decoded + "index.html";
        StringBuilder sb = new StringBuilder("www");
        for (String seg : decoded.split("/")) {
            if (seg.isEmpty() || seg.equals(".")) continue;
            if (seg.equals("..")) return null;
            sb.append('/').append(seg);
        }
        if (sb.length() == 3) sb.append("/index.html");
        return sb.toString();
    }

    static String percentDecode(String s) {
        ByteArrayOutputStream buf = new ByteArrayOutputStream(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '%') {
                if (i + 2 >= s.length()) return null;
                int hi = Character.digit(s.charAt(i + 1), 16), lo = Character.digit(s.charAt(i + 2), 16);
                if (hi < 0 || lo < 0) return null;
                buf.write(hi * 16 + lo);
                i += 2;
            } else if (c < 0x80) {
                buf.write(c);
            } else {
                byte[] b = String.valueOf(c).getBytes(StandardCharsets.UTF_8);
                buf.write(b, 0, b.length);
            }
        }
        return new String(buf.toByteArray(), StandardCharsets.UTF_8);
    }

    static String contentType(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        int dot = p.lastIndexOf('.');
        String ext = dot >= 0 ? p.substring(dot + 1) : "";
        switch (ext) {
            case "html": case "htm": return "text/html; charset=utf-8";
            case "js": case "mjs": return "text/javascript; charset=utf-8";
            case "css": return "text/css; charset=utf-8";
            case "json": return "application/json; charset=utf-8";
            case "webmanifest": return "application/manifest+json; charset=utf-8";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "ico": return "image/x-icon";
            case "woff2": return "font/woff2";
            case "woff": return "font/woff";
            case "txt": return "text/plain; charset=utf-8";
            case "wasm": return "application/wasm";
            case "glb": return "model/gltf-binary";
            default: return "application/octet-stream";
        }
    }

    private static void send(OutputStream out, int code, String type, byte[] body, boolean head) throws IOException {
        StringBuilder h = new StringBuilder();
        h.append("HTTP/1.1 ").append(code).append(' ').append(reason(code)).append("\r\n");
        h.append("Content-Type: ").append(type).append("\r\n");
        h.append("Content-Length: ").append(body.length).append("\r\n");
        h.append("Cache-Control: no-cache\r\n");
        h.append("X-Content-Type-Options: nosniff\r\n");
        if (code == 405) h.append("Allow: GET, HEAD\r\n");
        h.append("Connection: close\r\n\r\n");
        out.write(h.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (!head) out.write(body);
        out.flush();
    }

    private static String reason(int code) {
        switch (code) {
            case 200: return "OK";
            case 400: return "Bad Request";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 431: return "Request Header Fields Too Large";
            default: return "Error";
        }
    }

    /** Lee una línea terminada en \n (sin \r\n). null si se cerró la conexión antes. */
    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int c;
        boolean any = false;
        while ((c = in.read()) != -1) {
            any = true;
            if (c == '\n') break;
            if (c != '\r') sb.append((char) c);
            if (sb.length() > MAX_HEADER_BYTES) throw new IOException("línea demasiado larga");
        }
        return any ? sb.toString() : null;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(64 * 1024);
        byte[] buf = new byte[32 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private static byte[] bytes(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }
}
